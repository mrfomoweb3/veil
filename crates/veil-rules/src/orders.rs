//! Orders as players write them, and the silent clamping that turns them into a legal plan.
//!
//! Nothing here ever errors: a bad order is dropped or clamped, and the reason goes only into
//! that player's own (encrypted) view. Errors would leak information.

use crate::hex::{Board, Hex};
use crate::state::{GameState, Prices, FORT_COST, MAX_MOVES, MAX_RECRUIT, SCOUT_COST, SCOUT_MAX_STEPS};
use serde::{Deserialize, Serialize};

/// Orders are padded to this many bytes before encryption so ciphertext length says nothing.
pub const ORDERS_PLAINTEXT_LEN: usize = 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Move {
    pub from: Hex,
    pub to: Hex,
    pub count: u32,
}

/// What you can buy from a warlord.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TradeKind {
    /// Reveal this island (and its neighbours) if the warlord can see it.
    Intel { at: Hex },
    /// The warlord won't move into your islands for this many turns (this one included).
    Truce { turns: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trade {
    /// The warlord's seat.
    pub with: u8,
    pub kind: TradeKind,
}

pub const MAX_TRADES: usize = 2;
pub const MAX_TRUCE_TURNS: u32 = 5;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Orders {
    #[serde(default)]
    pub moves: Vec<Move>,
    #[serde(default)]
    pub scout: Option<Vec<Hex>>,
    #[serde(default)]
    pub fort: Option<Hex>,
    #[serde(default)]
    pub recruit: u32,
    /// Purchases from warlords, paid in aether before anything else this turn.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trades: Vec<Trade>,
    /// Warlords only: the prices they will charge from next turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prices: Option<Prices>,
}

impl Orders {
    pub fn is_empty(&self) -> bool {
        self.moves.is_empty() && self.scout.is_none() && self.fort.is_none() && self.recruit == 0 && self.trades.is_empty()
    }

    /// `u16` big-endian length, the JSON, zero padding to `ORDERS_PLAINTEXT_LEN`.
    pub fn to_padded(&self) -> Option<Vec<u8>> {
        let json = serde_json::to_vec(self).ok()?;
        if json.len() + 2 > ORDERS_PLAINTEXT_LEN {
            return None;
        }
        let mut out = Vec::with_capacity(ORDERS_PLAINTEXT_LEN);
        out.extend_from_slice(&(json.len() as u16).to_be_bytes());
        out.extend_from_slice(&json);
        out.resize(ORDERS_PLAINTEXT_LEN, 0);
        Some(out)
    }

    pub fn from_padded(bytes: &[u8]) -> Option<Orders> {
        if bytes.len() < 2 {
            return None;
        }
        let n = u16::from_be_bytes([bytes[0], bytes[1]]) as usize;
        let json = bytes.get(2..2 + n)?;
        serde_json::from_slice(json).ok()
    }
}

/// Why an order was dropped or clamped. Codes are part of the view wire format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Issue {
    Unreadable = 1,
    Missed = 2,
    TooManyMoves = 3,
    NotYourTile = 4,
    NotAdjacent = 5,
    Impassable = 6,
    NotEnoughTroops = 7,
    RecruitClamped = 8,
    NotEnoughAether = 9,
    FortInvalid = 10,
    ScoutInvalid = 11,
    ScoutTruncated = 12,
    ScoutLost = 13,
    IntelBought = 14,
    TruceBought = 15,
    /// The warlord can't see that island, so there was nothing to sell (nothing charged).
    TradeUnknown = 16,
    /// Not a living warlord, a bad request, or too many trades.
    TradeRefused = 17,
    /// You attacked a warlord you had a truce with: the truce is over.
    TruceBroken = 18,
}

impl Issue {
    pub fn from_u8(v: u8) -> Option<Issue> {
        use Issue::*;
        Some(match v {
            1 => Unreadable,
            2 => Missed,
            3 => TooManyMoves,
            4 => NotYourTile,
            5 => NotAdjacent,
            6 => Impassable,
            7 => NotEnoughTroops,
            8 => RecruitClamped,
            9 => NotEnoughAether,
            10 => FortInvalid,
            11 => ScoutInvalid,
            12 => ScoutTruncated,
            13 => ScoutLost,
            14 => IntelBought,
            15 => TruceBought,
            16 => TradeUnknown,
            17 => TradeRefused,
            18 => TruceBroken,
            _ => return None,
        })
    }
}

/// Which order an issue refers to: 0..6 are moves, the rest name the single orders.
pub const ORDER_RECRUIT: u8 = 200;
pub const ORDER_FORT: u8 = 201;
pub const ORDER_SCOUT: u8 = 202;
pub const ORDER_ALL: u8 = 255;
/// Trades are numbered from here (210 = first trade).
pub const ORDER_TRADE: u8 = 210;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Feedback {
    pub issue: Issue,
    pub order: u8,
}

/// A legal plan, in tile indices.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub recruit: u32,
    pub fort: Option<usize>,
    /// (from, to, count), merged per (from, to), count > 0.
    pub moves: Vec<(usize, usize, u32)>,
    /// Tile indices walked, ≥ 1 step.
    pub scout: Option<Vec<usize>>,
}

/// Clamp `orders` against the state at the start of the turn. Spending order: recruit, fort, scout.
pub fn sanitize(state: &GameState, board: &Board, p: u8, orders: &Orders) -> (Plan, Vec<Feedback>) {
    let mut plan = Plan::default();
    let mut fb = Vec::new();
    let me = &state.players[p as usize];
    if !me.alive {
        return (plan, fb);
    }
    let owned = |i: usize| state.tiles[i].owner == Some(p);
    let mut aether = me.aether;
    let capital = board.index(me.capital).expect("capital on board");

    // Recruit.
    if orders.recruit > 0 {
        let want = orders.recruit;
        let n = want.min(MAX_RECRUIT).min(aether);
        if !owned(capital) {
            fb.push(Feedback { issue: Issue::NotYourTile, order: ORDER_RECRUIT });
        } else {
            if n < want {
                fb.push(Feedback { issue: Issue::RecruitClamped, order: ORDER_RECRUIT });
            }
            plan.recruit = n;
            aether -= n;
        }
    }

    // Fort.
    if let Some(h) = orders.fort {
        match board.index(h) {
            Some(i) if owned(i) && !state.tiles[i].fort => {
                if aether >= FORT_COST {
                    aether -= FORT_COST;
                    plan.fort = Some(i);
                } else {
                    fb.push(Feedback { issue: Issue::NotEnoughAether, order: ORDER_FORT });
                }
            }
            _ => fb.push(Feedback { issue: Issue::FortInvalid, order: ORDER_FORT }),
        }
    }

    // Scout: starts from (or next to) one of our tiles, walks ≤ 3 adjacent passable steps.
    if let Some(path) = &orders.scout {
        let mut steps: Vec<usize> = Vec::new();
        let mut valid_start = false;
        let mut truncated = false;
        for (k, h) in path.iter().take(SCOUT_MAX_STEPS).enumerate() {
            let Some(i) = board.index(*h) else {
                truncated = true;
                break;
            };
            if k == 0 {
                valid_start = owned(i) || h.neighbors().iter().any(|n| board.index(*n).is_some_and(owned));
                if !valid_start {
                    break;
                }
            } else if !board.hex(*steps.last().unwrap()).is_adjacent(*h) {
                truncated = true;
                break;
            }
            if !state.tiles[i].terrain.passable() {
                truncated = true;
                break;
            }
            steps.push(i);
        }
        if path.len() > SCOUT_MAX_STEPS {
            truncated = true;
        }
        if !valid_start || steps.is_empty() {
            fb.push(Feedback { issue: Issue::ScoutInvalid, order: ORDER_SCOUT });
        } else if aether < SCOUT_COST {
            fb.push(Feedback { issue: Issue::NotEnoughAether, order: ORDER_SCOUT });
        } else {
            if truncated {
                fb.push(Feedback { issue: Issue::ScoutTruncated, order: ORDER_SCOUT });
            }
            plan.scout = Some(steps);
        }
    }

    // Moves: one step, from our tile, to a passable neighbour, bounded by troops present.
    let mut available: Vec<u32> = state.tiles.iter().map(|t| if t.owner == Some(p) { t.troops } else { 0 }).collect();
    available[capital] += plan.recruit;
    for (k, m) in orders.moves.iter().enumerate() {
        let k8 = k.min(254) as u8;
        if k >= MAX_MOVES {
            fb.push(Feedback { issue: Issue::TooManyMoves, order: k8 });
            continue;
        }
        let (Some(f), Some(t)) = (board.index(m.from), board.index(m.to)) else {
            fb.push(Feedback { issue: Issue::NotYourTile, order: k8 });
            continue;
        };
        if !owned(f) {
            fb.push(Feedback { issue: Issue::NotYourTile, order: k8 });
            continue;
        }
        if !m.from.is_adjacent(m.to) {
            fb.push(Feedback { issue: Issue::NotAdjacent, order: k8 });
            continue;
        }
        if !state.tiles[t].terrain.passable() {
            fb.push(Feedback { issue: Issue::Impassable, order: k8 });
            continue;
        }
        let n = m.count.min(available[f]);
        if n < m.count {
            fb.push(Feedback { issue: Issue::NotEnoughTroops, order: k8 });
        }
        if n == 0 {
            continue;
        }
        available[f] -= n;
        if let Some(e) = plan.moves.iter_mut().find(|e| e.0 == f && e.1 == t) {
            e.2 += n;
        } else {
            plan.moves.push((f, t, n));
        }
    }
    (plan, fb)
}

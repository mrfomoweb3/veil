//! The heuristic warlord. It plays from a `PlayerView` only, so it obeys the same fog as a
//! human. It is the fallback whenever the LLM warlord is slow, wrong or unavailable.

use crate::hex::{Board, Hex};
use crate::orders::{Move, Orders};
use crate::state::{Prices, Terrain, FORT_COST, FORT_MULT, MAX_MOVES, MAX_RECRUIT, SCALE, SCOUT_COST};
use crate::view::{PlayerView, VisibleTile};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Personality {
    /// Holds a fat garrison, forts up, expands carefully.
    Admiral,
    /// Throws everything forward.
    Raider,
    /// Grabs shrines and weak tiles, avoids even fights.
    Opportunist,
}

impl Personality {
    pub fn for_seat(seat: u8) -> Personality {
        match seat % 3 {
            0 => Personality::Admiral,
            1 => Personality::Raider,
            _ => Personality::Opportunist,
        }
    }

    /// A warlord's personality belongs to its wallet (`warlord-K.veil`), not to the seat it
    /// happens to sit in; anyone else on autopilot plays by seat.
    pub fn for_account(account: &str, seat: u8) -> Personality {
        account
            .strip_prefix("warlord-")
            .and_then(|r| r.strip_suffix(".veil"))
            .and_then(|k| k.parse::<u8>().ok())
            .map(Personality::for_seat)
            .unwrap_or(Personality::for_seat(seat))
    }

    pub fn title(self) -> &'static str {
        match self {
            Personality::Admiral => "the Cautious Admiral",
            Personality::Raider => "the Raider",
            Personality::Opportunist => "the Opportunist",
        }
    }

    /// How much stronger (×1000) we must be before attacking a held tile.
    fn attack_margin(self) -> u64 {
        match self {
            Personality::Admiral => 1500,
            Personality::Raider => 1050,
            Personality::Opportunist => 1300,
        }
    }

    /// What this warlord charges. Intel gets dearer as the war goes on; truces are cheap for
    /// the peaceful Admiral, dear for the Raider, and discounted when the warlord is under threat.
    pub fn prices(self, turn: u32, threatened: bool) -> Prices {
        let (intel, truce) = match self {
            Personality::Admiral => (5, 2),
            Personality::Raider => (4, 7),
            Personality::Opportunist => (3, 4),
        };
        let truce: u32 = if threatened { (truce as u32).saturating_sub(1).max(1) } else { truce };
        Prices { intel: intel + turn / 4, truce }
    }

    fn garrison_factor(self) -> u32 {
        match self {
            Personality::Admiral => 2,
            _ => 1,
        }
    }
}

/// A legal one-step move: from one of our tiles to a visible passable neighbour, up to `max`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegalMove {
    pub from: Hex,
    pub to: Hex,
    pub max: u32,
}

fn tiles_by_index(view: &PlayerView, board: &Board) -> Vec<Option<VisibleTile>> {
    let mut out = vec![None; board.len()];
    for t in &view.tiles {
        if (t.index as usize) < out.len() {
            out[t.index as usize] = Some(t.clone());
        }
    }
    out
}

/// Every one-step move the view allows (recruits not included). Used for LLM prompts.
pub fn legal_moves(view: &PlayerView) -> Vec<LegalMove> {
    let board = view.board();
    let known = tiles_by_index(view, &board);
    let mut out = Vec::new();
    for t in known.iter().flatten() {
        if t.owner != Some(view.me) || t.troops == 0 {
            continue;
        }
        let h = board.hex(t.index as usize);
        for n in h.neighbors() {
            if let Some(Some(nt)) = board.index(n).map(|i| &known[i]) {
                if nt.terrain.passable() {
                    out.push(LegalMove { from: h, to: n, max: t.troops as u32 });
                }
            }
        }
    }
    out
}

pub fn bot_orders(view: &PlayerView, personality: Personality) -> Orders {
    let mut orders = Orders::default();
    if !view.alive || view.game_over {
        return orders;
    }
    let board = view.board();
    let known = tiles_by_index(view, &board);
    let me = view.me;
    let capital = view.capital as usize;
    let cap_hex = board.hex(capital);
    let mine = |i: usize| known[i].as_ref().is_some_and(|t| t.owner == Some(me));
    let enemy_troops_near = |i: usize| -> u32 {
        board
            .hex(i)
            .neighbors()
            .iter()
            .filter_map(|n| board.index(*n))
            .filter_map(|j| known[j].as_ref())
            .filter(|t| t.owner.is_some_and(|o| o != me))
            .map(|t| t.troops as u32)
            .sum()
    };

    // Economy: scout every third turn, fort the capital when threatened and rich.
    let mut aether = view.aether;
    let threat = enemy_troops_near(capital);
    let scout_turn = view.turn % 3 == 2;
    let cap_tile = known[capital].clone();
    if threat > 0 && cap_tile.as_ref().is_some_and(|t| !t.fort) && aether >= FORT_COST + 4 {
        orders.fort = Some(cap_hex);
        aether -= FORT_COST;
    }
    if orders.fort.is_none() && aether >= FORT_COST + MAX_RECRUIT + SCOUT_COST {
        if let Some(t) = known
            .iter()
            .flatten()
            .filter(|t| t.owner == Some(me) && !t.fort && t.troops >= 4)
            .filter(|t| enemy_troops_near(t.index as usize) > 0)
            .max_by_key(|t| (t.troops, t.index))
        {
            orders.fort = Some(board.hex(t.index as usize));
            aether -= FORT_COST;
        }
    }
    let reserve = if scout_turn { SCOUT_COST } else { 0 };
    let recruit = aether.saturating_sub(reserve).min(MAX_RECRUIT);
    orders.recruit = recruit;
    aether -= recruit;

    // Distance (over known passable tiles) to the nearest tile we don't own: our frontier map.
    let mut frontier_dist = vec![u32::MAX; board.len()];
    let mut q = VecDeque::new();
    for (i, t) in known.iter().enumerate() {
        if let Some(t) = t {
            if t.terrain.passable() && t.owner != Some(me) {
                frontier_dist[i] = 0;
                q.push_back(i);
            }
        }
    }
    while let Some(i) = q.pop_front() {
        for n in board.hex(i).neighbors() {
            if let Some(j) = board.index(n) {
                if mine(j) && frontier_dist[j] == u32::MAX {
                    frontier_dist[j] = frontier_dist[i] + 1;
                    q.push_back(j);
                }
            }
        }
    }

    // Distance (over our own tiles) to the nearest visible enemy stack: where to mass troops.
    let mut enemy_dist = vec![u32::MAX; board.len()];
    let mut q = VecDeque::new();
    for (i, t) in known.iter().enumerate() {
        if let Some(t) = t {
            if t.owner.is_some_and(|o| o != me) {
                enemy_dist[i] = 0;
                q.push_back(i);
            }
        }
    }
    while let Some(i) = q.pop_front() {
        for n in board.hex(i).neighbors() {
            if let Some(j) = board.index(n) {
                if mine(j) && enemy_dist[j] == u32::MAX {
                    enemy_dist[j] = enemy_dist[i] + 1;
                    q.push_back(j);
                }
            }
        }
    }
    let besieging = |i: usize| {
        board.hex(i).neighbors().iter().filter_map(|n| board.index(*n)).any(|j| {
            known[j].as_ref().is_some_and(|t| t.terrain == Terrain::Capital && t.owner.is_some_and(|o| o != me))
        })
    };

    let alive: Vec<bool> = view.seats.iter().map(|s| s.alive).collect();
    let goal = crate::map::infer_capitals(view.radius as u32, view.seats.len(), me, cap_hex)
        .into_iter()
        .enumerate()
        .filter(|(p, _)| *p as u8 != me && alive[*p])
        .map(|(_, h)| h)
        .min_by_key(|h| (h.distance(cap_hex), *h));

    // Stacks, biggest first.
    let mut stacks: Vec<(usize, u32)> = known
        .iter()
        .flatten()
        .filter(|t| t.owner == Some(me))
        .map(|t| {
            let extra = if t.index as usize == capital { recruit } else { 0 };
            (t.index as usize, t.troops as u32 + extra)
        })
        .filter(|&(_, n)| n > 1)
        .collect();
    stacks.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let mut claimed: Vec<usize> = Vec::new();
    for (i, troops) in stacks {
        if orders.moves.len() >= MAX_MOVES {
            break;
        }
        let h = board.hex(i);
        let near = enemy_troops_near(i);
        let keep = if i == capital {
            (2 + near * 13 / 10) * personality.garrison_factor()
        } else if frontier_dist[i] == 1 {
            1 + near / 2
        } else {
            0
        };
        let spare = troops.saturating_sub(keep);
        if spare == 0 {
            continue;
        }

        // Best adjacent target.
        let mut best: Option<(i64, usize, u32)> = None;
        for n in h.neighbors() {
            let Some(j) = board.index(n) else { continue };
            let Some(t) = &known[j] else { continue };
            if !t.terrain.passable() || t.owner == Some(me) {
                continue;
            }
            let value: i64 = match t.terrain {
                Terrain::Capital => 9,
                Terrain::Shrine => 6,
                _ => 3,
            };
            let send = if t.owner.is_some() && t.troops > 0 {
                let def = t.troops as u64 * t.terrain.defense() * if t.fort { FORT_MULT } else { SCALE } / SCALE;
                if (spare as u64) * SCALE < def * personality.attack_margin() / SCALE {
                    continue;
                }
                spare
            } else if personality == Personality::Raider {
                spare
            } else {
                // Spread out: claim empty land with a modest detachment.
                spare.min(2.max(spare / 2))
            };
            let crowd = if claimed.contains(&j) { 4 } else { 0 };
            let score = value * 10 - t.troops as i64 - crowd;
            if best.is_none_or(|b| score > b.0) {
                best = Some((score, j, send));
            }
        }
        if let Some((_, j, send)) = best {
            let target_is_capital = known[j].as_ref().is_some_and(|t| t.terrain == Terrain::Capital);
            // A siege stack doesn't wander off after small prizes: it waits and grows.
            if besieging(i) && !target_is_capital && personality != Personality::Admiral {
                continue;
            }
            claimed.push(j);
            orders.moves.push(Move { from: h, to: board.hex(j), count: send });
            continue;
        }
        if besieging(i) {
            continue;
        }

        // March on the nearest living enemy capital (its position is public).
        if personality != Personality::Admiral || view.turn >= 8 {
            if let Some(goal) = goal {
                let step = h
                    .neighbors()
                    .into_iter()
                    .filter(|n| n.distance(goal) < h.distance(goal))
                    .filter(|n| board.index(*n).is_some_and(|j| known[j].as_ref().is_some_and(|t| t.terrain.passable())))
                    .min_by_key(|n| {
                        let j = board.index(*n).unwrap();
                        let t = known[j].as_ref().unwrap();
                        (t.owner.is_some_and(|o| o != me) as u8, t.troops, *n)
                    });
                if let Some(n) = step {
                    let j = board.index(n).unwrap();
                    let t = known[j].as_ref().unwrap();
                    let ok = t.owner == Some(me)
                        || t.owner.is_none()
                        || (spare as u64) * SCALE
                            >= t.troops as u64 * t.terrain.defense() * personality.attack_margin() / SCALE;
                    if ok && (i != capital || spare > 2) {
                        orders.moves.push(Move { from: h, to: n, count: spare });
                        continue;
                    }
                }
            }
        }

        // Aggressive warlords mass toward the enemy they can see.
        let toward = |dist: &Vec<u32>| {
            h.neighbors()
                .into_iter()
                .filter(|n| board.index(*n).is_some_and(|j| mine(j) && dist[j] < dist[i]))
                .min()
        };
        if personality != Personality::Admiral && enemy_dist[i] != u32::MAX && enemy_dist[i] > 1 {
            if let Some(n) = toward(&enemy_dist) {
                orders.moves.push(Move { from: h, to: n, count: spare });
                continue;
            }
        }

        // No target: walk toward the frontier.
        if frontier_dist[i] != u32::MAX && frontier_dist[i] > 1 && i != capital {
            if let Some(n) = h
                .neighbors()
                .iter()
                .filter(|n| board.index(**n).is_some_and(|j| mine(j) && frontier_dist[j] < frontier_dist[i]))
                .min()
            {
                orders.moves.push(Move { from: h, to: *n, count: spare });
            }
        } else if i == capital && spare > 2 {
            // Push recruits out of the capital toward the frontier.
            if let Some(n) = h
                .neighbors()
                .iter()
                .filter(|n| board.index(**n).is_some_and(|j| mine(j) && frontier_dist[j] < frontier_dist[i]))
                .min()
            {
                orders.moves.push(Move { from: h, to: *n, count: spare });
            }
        }
    }

    // Scout: from our outermost tile, three steps heading away from home.
    if scout_turn && aether >= SCOUT_COST {
        if let Some(start) = known
            .iter()
            .flatten()
            .filter(|t| t.owner == Some(me))
            .map(|t| board.hex(t.index as usize))
            .max_by_key(|h| (h.distance(cap_hex), std::cmp::Reverse(*h)))
        {
            let mut path = Vec::new();
            let mut cur = start;
            for _ in 0..3 {
                let next = cur
                    .neighbors()
                    .into_iter()
                    .filter(|n| board.contains(*n) && !path.contains(n) && *n != start)
                    .filter(|n| {
                        board
                            .index(*n)
                            .is_none_or(|j| known[j].as_ref().is_none_or(|t| t.terrain.passable()))
                    })
                    .max_by_key(|n| (n.distance(cap_hex), std::cmp::Reverse(*n)));
                let Some(n) = next else { break };
                path.push(n);
                cur = n;
            }
            if !path.is_empty() {
                orders.scout = Some(path);
            }
        }
    }
    orders.prices = Some(personality.prices(view.turn, threat > 0));
    orders
}

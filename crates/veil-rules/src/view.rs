//! A player's view of the board, and its fixed-size binary encoding.
//!
//! Every view encodes to exactly `VIEW_PLAINTEXT_LEN` bytes, so ciphertext length says nothing
//! about how much a player can see. The TypeScript client decodes the same format
//! (`web/src/protocol/view.ts`).

use crate::hex::Board;
use crate::orders::{Feedback, Issue};
use crate::resolve::{BattleReport, TurnOutcome};
use crate::state::{GameState, Terrain};
use crate::vision::vision;
use serde::{Deserialize, Serialize};

pub const VIEW_VERSION: u8 = 1;
pub const VIEW_PLAINTEXT_LEN: usize = 1024;
const MAX_REPORTS: usize = 24;
const MAX_FEEDBACK: usize = 32;
const NONE: u8 = 255;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisibleTile {
    pub index: u8,
    pub terrain: Terrain,
    pub owner: Option<u8>,
    pub troops: u16,
    pub fort: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatSummary {
    pub alive: bool,
    pub tiles: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerView {
    /// The turn this view follows (0 = opening view).
    pub turn: u32,
    pub me: u8,
    pub radius: u8,
    /// Index of this player's own capital tile.
    pub capital: u8,
    pub alive: bool,
    pub game_over: bool,
    pub aether: u32,
    pub income: u32,
    pub seats: Vec<SeatSummary>,
    pub scout: Option<u8>,
    pub tiles: Vec<VisibleTile>,
    pub reports: Vec<BattleReport>,
    pub feedback: Vec<Feedback>,
}

/// Build `p`'s view after a turn (or the opening view when `outcome` is `None`).
/// `extra` is feedback the engine adds before resolution (missed turn, unreadable orders).
pub fn build_view(state: &GameState, p: u8, outcome: Option<&TurnOutcome>, extra: &[Feedback]) -> PlayerView {
    let board = state.board();
    let scout = outcome.and_then(|o| o.scouts[p as usize]);
    let seen = vision(state, &board, p, scout);
    let tiles = (0..board.len())
        .filter(|&i| seen[i])
        .map(|i| {
            let t = &state.tiles[i];
            VisibleTile {
                index: i as u8,
                terrain: t.terrain,
                owner: t.owner,
                troops: t.troops.min(u16::MAX as u32) as u16,
                fort: t.fort,
            }
        })
        .collect();
    let counts = state.tile_counts();
    let me = &state.players[p as usize];
    let mut feedback: Vec<Feedback> = extra.to_vec();
    if let Some(o) = outcome {
        feedback.extend(o.feedback[p as usize].iter().copied());
    }
    feedback.truncate(MAX_FEEDBACK);
    let mut reports = outcome.map(|o| o.reports[p as usize].clone()).unwrap_or_default();
    reports.truncate(MAX_REPORTS);
    PlayerView {
        turn: state.turn - 1,
        me: p,
        radius: state.radius as u8,
        capital: board.index(me.capital).unwrap() as u8,
        alive: me.alive,
        game_over: state.game_over,
        aether: me.aether,
        income: if me.alive { state.income_of(p) } else { 0 },
        seats: state
            .players
            .iter()
            .enumerate()
            .map(|(i, pl)| SeatSummary { alive: pl.alive, tiles: counts[i].min(u16::MAX as u32) as u16 })
            .collect(),
        scout: scout.map(|s| s as u8),
        tiles,
        reports,
        feedback,
    }
}

fn u16c(v: u32) -> [u8; 2] {
    (v.min(u16::MAX as u32) as u16).to_be_bytes()
}

impl PlayerView {
    /// Fixed-length encoding: `u16` length, body, zero padding to `VIEW_PLAINTEXT_LEN`.
    pub fn encode(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(VIEW_PLAINTEXT_LEN);
        b.push(VIEW_VERSION);
        b.push(self.me);
        b.push(self.radius);
        b.push(self.capital);
        b.push(self.alive as u8 | (self.game_over as u8) << 1);
        b.extend_from_slice(&self.turn.to_be_bytes());
        b.extend_from_slice(&self.aether.to_be_bytes());
        b.extend_from_slice(&self.income.to_be_bytes());
        b.push(self.seats.len() as u8);
        for s in &self.seats {
            b.push(s.alive as u8);
            b.extend_from_slice(&s.tiles.to_be_bytes());
        }
        b.push(self.scout.unwrap_or(NONE));
        b.push(self.tiles.len() as u8);
        for t in &self.tiles {
            b.push(t.index);
            b.push(t.terrain as u8 | (t.fort as u8) << 3);
            b.push(t.owner.unwrap_or(NONE));
            b.extend_from_slice(&t.troops.to_be_bytes());
        }
        b.push(self.reports.len() as u8);
        for r in &self.reports {
            b.push(r.tile as u8);
            b.push(r.edge_to.map(|e| e as u8).unwrap_or(NONE));
            b.push(r.won as u8);
            for v in [r.mine_before, r.mine_after, r.others_before, r.others_after] {
                b.extend_from_slice(&u16c(v));
            }
        }
        b.push(self.feedback.len() as u8);
        for f in &self.feedback {
            b.push(f.issue as u8);
            b.push(f.order);
        }
        let mut out = Vec::with_capacity(VIEW_PLAINTEXT_LEN);
        out.extend_from_slice(&(b.len() as u16).to_be_bytes());
        out.extend_from_slice(&b);
        assert!(out.len() <= VIEW_PLAINTEXT_LEN, "view exceeds fixed size");
        out.resize(VIEW_PLAINTEXT_LEN, 0);
        out
    }

    pub fn decode(bytes: &[u8]) -> Option<PlayerView> {
        let n = u16::from_be_bytes([*bytes.first()?, *bytes.get(1)?]) as usize;
        let mut r = Reader { b: bytes.get(2..2 + n)?, i: 0 };
        if r.u8()? != VIEW_VERSION {
            return None;
        }
        let me = r.u8()?;
        let radius = r.u8()?;
        let capital = r.u8()?;
        let flags = r.u8()?;
        let turn = r.u32()?;
        let aether = r.u32()?;
        let income = r.u32()?;
        let seats = (0..r.u8()?)
            .map(|_| Some(SeatSummary { alive: r.u8()? != 0, tiles: r.u16()? }))
            .collect::<Option<Vec<_>>>()?;
        let scout = Some(r.u8()?).filter(|&s| s != NONE);
        let tiles = (0..r.u8()?)
            .map(|_| {
                let index = r.u8()?;
                let packed = r.u8()?;
                let owner = Some(r.u8()?).filter(|&o| o != NONE);
                Some(VisibleTile {
                    index,
                    terrain: Terrain::from_u8(packed & 0x7)?,
                    fort: packed & 0x8 != 0,
                    owner,
                    troops: r.u16()?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let reports = (0..r.u8()?)
            .map(|_| {
                Some(BattleReport {
                    tile: r.u8()? as usize,
                    edge_to: Some(r.u8()?).filter(|&e| e != NONE).map(|e| e as usize),
                    won: r.u8()? != 0,
                    mine_before: r.u16()? as u32,
                    mine_after: r.u16()? as u32,
                    others_before: r.u16()? as u32,
                    others_after: r.u16()? as u32,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let feedback = (0..r.u8()?)
            .map(|_| Some(Feedback { issue: Issue::from_u8(r.u8()?)?, order: r.u8()? }))
            .collect::<Option<Vec<_>>>()?;
        Some(PlayerView {
            turn,
            me,
            radius,
            capital,
            alive: flags & 1 != 0,
            game_over: flags & 2 != 0,
            aether,
            income,
            seats,
            scout,
            tiles,
            reports,
            feedback,
        })
    }

    pub fn board(&self) -> Board {
        Board::new(self.radius as u32)
    }
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl Reader<'_> {
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.i)?;
        self.i += 1;
        Some(v)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes([self.u8()?, self.u8()?]))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes([self.u8()?, self.u8()?, self.u8()?, self.u8()?]))
    }
}

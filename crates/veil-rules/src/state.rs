//! Game state. This is what the enclave seals; nobody outside it sees it until The Reveal.

use crate::hex::{Board, Hex};
use serde::{Deserialize, Serialize};

/// Fixed-point scale for every multiplier (1000 = ×1.0). No floats anywhere in the rules.
pub const SCALE: u64 = 1000;
pub const FORT_MULT: u64 = 1500;
pub const FORT_COST: u32 = 6;
pub const SCOUT_COST: u32 = 2;
pub const MAX_RECRUIT: u32 = 10;
pub const MAX_MOVES: usize = 6;
pub const SCOUT_MAX_STEPS: usize = 3;
pub const SCOUT_RADIUS: u32 = 2;
pub const START_TROOPS: u32 = 6;
pub const START_AETHER: u32 = 4;
pub const MAX_SEATS: usize = 6;
pub const MIN_SEATS: usize = 2;
/// A player holding this share (per mille) of non-void tiles at end of turn wins outright.
pub const DOMINATION_PERMILLE: u64 = 600;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    Plains = 0,
    Forest = 1,
    Highland = 2,
    Shrine = 3,
    Void = 4,
    Capital = 5,
}

impl Terrain {
    pub fn from_u8(v: u8) -> Option<Terrain> {
        Some(match v {
            0 => Terrain::Plains,
            1 => Terrain::Forest,
            2 => Terrain::Highland,
            3 => Terrain::Shrine,
            4 => Terrain::Void,
            5 => Terrain::Capital,
            _ => return None,
        })
    }

    pub fn passable(self) -> bool {
        self != Terrain::Void
    }

    /// Defense multiplier (×1000). The capital's ×1.5 lives here and is applied once.
    pub fn defense(self) -> u64 {
        match self {
            Terrain::Forest => 1250,
            Terrain::Highland => 1150,
            Terrain::Capital => 1500,
            _ => SCALE,
        }
    }

    pub fn income(self) -> u32 {
        match self {
            Terrain::Shrine | Terrain::Capital => 3,
            Terrain::Void => 0,
            _ => 1,
        }
    }

    /// Extra sight range granted to troops standing on this tile.
    pub fn sight_bonus(self) -> u32 {
        match self {
            Terrain::Highland | Terrain::Capital => 1,
            _ => 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tile {
    pub terrain: Terrain,
    pub owner: Option<u8>,
    pub troops: u32,
    pub fort: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player {
    pub aether: u32,
    pub alive: bool,
    pub capital: Hex,
    /// Turn this player was eliminated on (ranking tiebreak), if any.
    pub eliminated_turn: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Config {
    pub max_turns: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config { max_turns: 20 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameState {
    pub match_id: u64,
    /// The next turn to resolve. Starts at 1; turn 0 is the opening view.
    pub turn: u32,
    pub radius: u32,
    pub config: Config,
    pub tiles: Vec<Tile>,
    pub players: Vec<Player>,
    pub game_over: bool,
}

impl GameState {
    pub fn board(&self) -> Board {
        Board::new(self.radius)
    }

    pub fn tile(&self, board: &Board, h: Hex) -> Option<&Tile> {
        board.index(h).map(|i| &self.tiles[i])
    }

    pub fn non_void_count(&self) -> usize {
        self.tiles.iter().filter(|t| t.terrain.passable()).count()
    }

    pub fn tile_counts(&self) -> Vec<u32> {
        let mut out = vec![0u32; self.players.len()];
        for t in &self.tiles {
            if let Some(o) = t.owner {
                out[o as usize] += 1;
            }
        }
        out
    }

    pub fn troop_counts(&self) -> Vec<u32> {
        let mut out = vec![0u32; self.players.len()];
        for t in &self.tiles {
            if let Some(o) = t.owner {
                out[o as usize] += t.troops;
            }
        }
        out
    }

    pub fn income_of(&self, p: u8) -> u32 {
        self.tiles
            .iter()
            .filter(|t| t.owner == Some(p))
            .map(|t| t.terrain.income())
            .sum()
    }

    pub fn alive_count(&self) -> usize {
        self.players.iter().filter(|p| p.alive).count()
    }

    /// Final ranking, best first: alive before eliminated, then tiles, aether, troops;
    /// eliminated players by how late they fell; seat index last so it is total.
    pub fn ranking(&self) -> Vec<u8> {
        let tiles = self.tile_counts();
        let troops = self.troop_counts();
        let mut ids: Vec<u8> = (0..self.players.len() as u8).collect();
        ids.sort_by(|&a, &b| {
            let (pa, pb) = (&self.players[a as usize], &self.players[b as usize]);
            let key = |p: &Player, i: u8| {
                (
                    p.alive,
                    tiles[i as usize],
                    p.aether,
                    troops[i as usize],
                    p.eliminated_turn.unwrap_or(u32::MAX),
                )
            };
            key(pb, b).cmp(&key(pa, a)).then(a.cmp(&b))
        });
        ids
    }

    /// Canonical bytes of the state, for commitments.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("state serializes")
    }
}

//! The public facts of a turn: what everyone, on chain, is allowed to know.

use crate::hex::Hex;
use crate::resolve::TurnOutcome;
use crate::state::GameState;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicTurn {
    pub turn: u32,
    /// Tiles where a battle broke out. Coordinates only: not who, not how many.
    pub battles: Vec<Hex>,
    pub skirmishes: Vec<(Hex, Hex)>,
    pub eliminated: Vec<u8>,
    /// Tile count per seat: the scoreboard.
    pub tiles: Vec<u32>,
    pub game_over: bool,
    /// Seats best first, once the match is over.
    pub ranking: Option<Vec<u8>>,
}

impl PublicTurn {
    pub fn opening(state: &GameState) -> PublicTurn {
        PublicTurn { turn: 0, tiles: state.tile_counts(), ..Default::default() }
    }

    pub fn after(state: &GameState, outcome: &TurnOutcome) -> PublicTurn {
        PublicTurn {
            turn: state.turn - 1,
            battles: outcome.battles.clone(),
            skirmishes: outcome.skirmishes.clone(),
            eliminated: outcome.eliminated.clone(),
            tiles: state.tile_counts(),
            game_over: state.game_over,
            ranking: state.game_over.then(|| state.ranking()),
        }
    }
}

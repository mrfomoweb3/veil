//! VEIL rules. Pure and deterministic: the same (state, orders, seed) always gives the same
//! next state. The enclave, the verifier and the client all run this exact code.

pub mod bot;
pub mod hex;
pub mod map;
pub mod orders;
pub mod public;
pub mod resolve;
pub mod state;
pub mod view;
pub mod vision;

pub use bot::{bot_orders, legal_moves, Personality};
pub use hex::{Board, Hex};
pub use map::generate;
pub use orders::{Feedback, Issue, Move, Orders};
pub use public::PublicTurn;
pub use resolve::{resolve, TurnOutcome};
pub use state::{Config, GameState, Terrain};
pub use view::{build_view, PlayerView};

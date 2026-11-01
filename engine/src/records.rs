//! What the enclave seals between runs, and the plaintext history it publishes at The Reveal.

use crate::host::Vrf;
use serde::{Deserialize, Serialize};
use veil_rules::{GameState, Orders, PublicTurn};

/// `m:{id}:cur` — the live match.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchRecord {
    pub accounts: Vec<String>,
    pub state: GameState,
    pub state_commit: String,
}

/// `m:{id}:init` — the opening, kept for The Reveal.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InitRecord {
    pub vrf: Vrf,
    pub state: GameState,
    pub state_commit: String,
}

/// `m:{id}:t:{turn}` — one resolved turn, kept for The Reveal.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnRecord {
    pub turn: u32,
    /// The orders each seat's turn ran with (after decryption; AI seats' generated orders).
    pub orders: Vec<Orders>,
    pub submitted: Vec<bool>,
    pub ai: Vec<bool>,
    /// Whether an AI seat's orders came from the LLM (`true`) or the heuristic bot.
    pub llm: Vec<bool>,
    pub vrf: Vrf,
    pub public: PublicTurn,
    pub state_commit: String,
}

/// The full plaintext history, published unencrypted when the match is over.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RevealDoc {
    pub version: u32,
    pub match_id: u64,
    pub accounts: Vec<String>,
    /// The per-match game secret key. With it anyone can decrypt the order ciphertexts that
    /// sat on chain and check they match `turns[*].orders`.
    pub game_sk_hex: String,
    pub game_pk_hex: String,
    /// Salt of every `state_commit` (sha256(salt || canonical state)).
    pub commit_salt_hex: String,
    pub init: InitRecord,
    pub turns: Vec<TurnRecord>,
    pub final_state: GameState,
}

pub fn commit(salt: &[u8], state: &GameState) -> String {
    let mut b = salt.to_vec();
    b.extend_from_slice(&state.canonical_bytes());
    veil_crypto::sha256_hex(&b)
}

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Mode {
    Practice,
    Stakes { buy_in: U128 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    Lobby,
    Starting,
    Running,
    Resolving,
    Finished,
    Revealing,
    Revealed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Seat {
    pub account: AccountId,
    /// X25519 public key (hex) the enclave encrypts this seat's view to.
    pub view_pk: String,
    /// An AI warlord seat (from the start).
    pub ai: bool,
    /// A human seat currently played by the AI after 3 missed turns (reclaimable).
    pub autopilot: bool,
    pub missed: u8,
    pub alive: bool,
    /// Buy-in paid (Stakes), refundable before start.
    pub paid: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Match {
    pub id: u64,
    pub host: AccountId,
    pub mode: Mode,
    pub status: Status,
    pub seats: Vec<Seat>,
    pub max_seats: u8,
    /// AI warlords added at start.
    pub ai_seats: u8,
    pub max_turns: u32,
    pub turn: u32,
    pub turn_len_ms: u64,
    pub deadline_ms: u64,
    pub game_pk: Option<String>,
    pub state_commit: Option<String>,
    /// Engine (OutLayer project id, or https URL run directly) and exact version (wasm
    /// sha256), pinned when the match is created.
    pub engine_project: String,
    pub engine_version: Option<String>,
    pub pot: U128,
    pub ranking: Option<Vec<u8>>,
    pub payouts: Vec<(AccountId, U128)>,
    pub reveal_hash: Option<String>,
    pub reveal_key: Option<String>,
    pub created_ms: u64,
    /// Consecutive engine failures (safety valve: 5 → refunds).
    pub failures: u8,
}

/// Exactly what the engine reported, verified where possible, kept per turn.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Vrf {
    pub output_hex: String,
    pub signature_hex: String,
    pub alpha: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PublicTurn {
    pub turn: u32,
    /// Raw public JSON from the engine (battles, skirmishes, eliminations, tile counts).
    pub public: String,
    pub state_commit: String,
    pub vrf: Vrf,
    pub resolved_ms: u64,
}

#[near(serializers = [json])]
pub struct ViewOut {
    pub turn: u32,
    pub ciphertext: String,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub outlayer: AccountId,
    pub engine_project: String,
    pub engine_version: Option<String>,
    pub vrf_pubkey: String,
    pub usdc: AccountId,
    pub rake_bps: u16,
    pub rake: U128,
}

/// A warlord's on-chain wallet. Funded by anyone; moved only by match results.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WarlordBook {
    /// USDC the warlord holds (6 decimals).
    pub treasury: U128,
    pub played: u32,
    pub won: u32,
    /// Total paid in buy-ins and total won in prizes, all time.
    pub staked: U128,
    pub earned: U128,
}

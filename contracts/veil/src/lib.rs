//! `veil.near` — the public half of VEIL.
//!
//! The contract never sees the map. It holds seats and money, keeps the turn clock, stores
//! order ciphertexts until the turn resolves, forwards them to the OutLayer enclave, verifies
//! the VRF proof that comes back, stores each player's encrypted view and the public facts,
//! and pays out from the attested result.

mod types;

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
pub use types::*;

pub const MIN_SEATS: usize = 2;
pub const MAX_SEATS: usize = 6;
pub const MAX_ORDERS_B64: usize = 2800;
pub const RETRY_DELAY_MS: u64 = 30_000;
pub const STALE_LOBBY_MS: u64 = 30 * 60 * 1000;
pub const MAX_FAILURES: u8 = 5;
pub const AUTOPILOT_AFTER: u8 = 3;
/// View key for AI seats: nobody reads their views (X25519 base point).
pub const MAX_WARLORDS: usize = 5;
/// AI warlords' seat accounts. Not real NEAR accounts: names in this contract's ledger.
pub fn warlord_id(k: usize) -> AccountId {
    format!("warlord-{k}.veil").parse().unwrap()
}
pub fn is_warlord(a: &AccountId) -> bool {
    (1..=MAX_WARLORDS).any(|k| &warlord_id(k) == a)
}
pub const AI_VIEW_PK: &str = "0900000000000000000000000000000000000000000000000000000000000000";
const CALLBACK_GAS: Gas = Gas::from_tgas(60);
const RESERVE_GAS: Gas = Gas::from_tgas(25);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Matches,
    Views,
    Orders,
    History,
    Balances,
    Warlords,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct ViewRec {
    pub turn: u32,
    pub ct: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Veil {
    owner: AccountId,
    outlayer: AccountId,
    engine_project: String,
    engine_version: Option<String>,
    vrf_pubkey: [u8; 32],
    usdc: AccountId,
    rake_bps: u16,
    rake: u128,
    next_id: u64,
    matches: IterableMap<u64, Match>,
    views: LookupMap<(u64, AccountId), ViewRec>,
    /// Current turn's order ciphertexts only; cleared when the turn resolves. Every submission
    /// is also logged (`veil_orders_submitted`), so the full record lives in chain history.
    orders: LookupMap<(u64, AccountId), String>,
    history: LookupMap<(u64, u32), PublicTurn>,
    /// Refunds and winnings, withdrawn with `claim`.
    balances: LookupMap<AccountId, u128>,
    /// AI warlords' wallets. There is no withdraw: only match results move this money.
    warlords: LookupMap<AccountId, WarlordBook>,
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "veil", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

fn parse_hex32(h: &str) -> Option<[u8; 32]> {
    hex::decode(h).ok().and_then(|b| b.try_into().ok())
}

/// Payout split (basis points) by number of paying seats.
pub fn shares(paying: usize) -> Vec<u128> {
    match paying {
        0 | 1 => vec![10_000],
        2 => vec![10_000],
        3 | 4 => vec![7_000, 3_000],
        _ => vec![6_000, 2_500, 1_500],
    }
}

/// The OutLayer code source for an engine. An `https://` engine is run directly by URL with
/// its sha256 pinned: OutLayer serves keys bound to the build (`bind: "wasm"`, which keeps match
/// state readable by this exact engine only) to direct runs, not to project runs.
pub(crate) fn engine_source(engine: &str, version: Option<String>) -> Value {
    if engine.starts_with("https://") {
        let hash = version.expect("a URL engine needs its sha256 pinned");
        json!({ "WasmUrl": { "url": engine, "hash": hash, "build_target": "wasm32-wasip2" } })
    } else {
        json!({ "Project": { "project_id": engine, "version_key": version } })
    }
}

#[near]
impl Veil {
    #[init]
    pub fn new(
        owner: AccountId,
        outlayer: AccountId,
        engine_project: String,
        engine_version: Option<String>,
        vrf_pubkey_hex: String,
        usdc: AccountId,
    ) -> Self {
        Self {
            owner,
            outlayer,
            engine_project,
            engine_version,
            vrf_pubkey: parse_hex32(&vrf_pubkey_hex).expect("vrf_pubkey_hex must be 32 bytes of hex"),
            usdc,
            rake_bps: 500,
            rake: 0,
            next_id: 1,
            matches: IterableMap::new(Key::Matches),
            views: LookupMap::new(Key::Views),
            orders: LookupMap::new(Key::Orders),
            history: LookupMap::new(Key::History),
            balances: LookupMap::new(Key::Balances),
            warlords: LookupMap::new(Key::Warlords),
        }
    }

    // ---------------------------------------------------------------- admin

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// New matches use this engine; running matches keep the version they were created with.
    /// `project` is an OutLayer project id, or the engine's https URL (then `version`, its
    /// sha256, is required).
    ///
    /// Refused while any match holds hidden state. Match state is sealed with project-bound keys
    /// for this contract (OutLayer gives storage only to project runs), so every version of the
    /// engine run by this contract derives the same keys. Swapping the engine only when no match
    /// is live means a new version can only ever see state that is public or not yet made.
    pub fn set_engine(&mut self, project: String, version: Option<String>) {
        self.assert_owner();
        require!(!project.starts_with("https://") || version.is_some(), "a URL engine needs its sha256");
        let live = self.matches.values().any(|m| matches!(m.status, Status::Starting | Status::Running | Status::Resolving | Status::Finished | Status::Revealing));
        require!(!live, "a match holds hidden state: finish and reveal (or cancel) it before changing the engine");
        self.engine_project = project;
        self.engine_version = version;
    }

    pub fn set_vrf_pubkey(&mut self, vrf_pubkey_hex: String) {
        self.assert_owner();
        self.vrf_pubkey = parse_hex32(&vrf_pubkey_hex).expect("32 bytes of hex");
    }

    pub fn withdraw_rake(&mut self, to: AccountId) -> Promise {
        self.assert_owner();
        let amount = std::mem::take(&mut self.rake);
        require!(amount > 0, "no rake");
        self.credit(&to, amount);
        self.claim_for(to)
    }

    // ---------------------------------------------------------------- lobby

    pub fn create_match(&mut self, mode: Mode, max_seats: u8, turn_len_ms: u64, ai_seats: u8, max_turns: Option<u32>) -> u64 {
        require!((MIN_SEATS..=MAX_SEATS).contains(&(max_seats as usize)), "2–6 seats");
        require!(ai_seats < max_seats, "leave room for a human");
        require!((15_000..=86_400_000).contains(&turn_len_ms), "turn length 15 s – 24 h");
        let max_turns = max_turns.unwrap_or(20);
        require!((1..=50).contains(&max_turns), "1–50 turns");
        if let Mode::Stakes { buy_in } = &mode {
            require!(buy_in.0 > 0, "buy-in must be positive");
        }
        let id = self.next_id;
        self.next_id += 1;
        let m = Match {
            id,
            host: env::predecessor_account_id(),
            mode,
            status: Status::Lobby,
            seats: vec![],
            max_seats,
            ai_seats,
            max_turns,
            turn: 0,
            turn_len_ms,
            deadline_ms: 0,
            game_pk: None,
            state_commit: None,
            engine_project: self.engine_project.clone(),
            engine_version: self.engine_version.clone(),
            pot: U128(0),
            ranking: None,
            payouts: vec![],
            reveal_hash: None,
            reveal_key: None,
            created_ms: env::block_timestamp_ms(),
            failures: 0,
        };
        emit("veil_match_created", json!({ "match": id, "host": m.host, "mode": m.mode, "max_seats": max_seats, "ai_seats": ai_seats }));
        self.matches.insert(id, m);
        id
    }

    fn get_mut(&mut self, id: u64) -> &mut Match {
        self.matches.get_mut(&id).expect("no such match")
    }

    fn seat_human(m: &mut Match, account: AccountId, view_pk: String, paid: u128) -> Result<(), &'static str> {
        if m.status != Status::Lobby {
            return Err("lobby closed");
        }
        if parse_hex32(&view_pk).is_none() {
            return Err("view_pk must be 32 bytes of hex");
        }
        if m.seats.iter().any(|s| s.account == account) {
            return Err("already seated");
        }
        if m.seats.len() + m.ai_seats as usize >= m.max_seats as usize {
            return Err("match is full");
        }
        m.seats.push(Seat { account, view_pk, ai: false, autopilot: false, missed: 0, alive: true, paid: U128(paid) });
        Ok(())
    }

    pub fn join_practice(&mut self, match_id: u64, view_pk: String) {
        let who = env::predecessor_account_id();
        let m = self.get_mut(match_id);
        require!(m.mode == Mode::Practice, "this is a stakes match: join with ft_transfer_call");
        if let Err(e) = Self::seat_human(m, who.clone(), view_pk, 0) {
            env::panic_str(e);
        }
        emit("veil_seat_joined", json!({ "match": match_id, "account": who }));
    }

    /// USDC `ft_transfer_call` with `msg = {"join": <match_id>, "view_pk": "<hex>"}`.
    /// Returns the amount to refund: everything on any failure, the excess on success.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if env::predecessor_account_id() != self.usdc {
            return amount;
        }
        let Ok(v) = serde_json::from_str::<Value>(&msg) else { return amount };
        // Anyone can stake a warlord: `{"fund_warlord": "warlord-1.veil"}`.
        if let Some(w) = v["fund_warlord"].as_str() {
            let Ok(w) = w.parse::<AccountId>() else { return amount };
            if !is_warlord(&w) {
                return amount;
            }
            let mut book = self.warlords.get(&w).cloned().unwrap_or_default();
            book.treasury = U128(book.treasury.0 + amount.0);
            self.warlords.insert(w.clone(), book);
            emit("veil_warlord_funded", json!({ "warlord": w, "by": sender_id, "amount": amount }));
            return U128(0);
        }
        let (Some(id), Some(pk)) = (v["join"].as_u64(), v["view_pk"].as_str()) else { return amount };
        let Some(m) = self.matches.get_mut(&id) else { return amount };
        let Mode::Stakes { buy_in } = m.mode.clone() else { return amount };
        if amount.0 < buy_in.0 {
            return amount;
        }
        if Self::seat_human(m, sender_id.clone(), pk.to_string(), buy_in.0).is_err() {
            return amount;
        }
        m.pot = U128(m.pot.0 + buy_in.0);
        emit("veil_seat_joined", json!({ "match": id, "account": sender_id, "paid": buy_in }));
        U128(amount.0 - buy_in.0)
    }

    pub fn leave_lobby(&mut self, match_id: u64) {
        let who = env::predecessor_account_id();
        let m = self.get_mut(match_id);
        require!(m.status == Status::Lobby, "match already started");
        let i = m.seats.iter().position(|s| s.account == who).expect("not seated");
        let seat = m.seats.remove(i);
        m.pot = U128(m.pot.0 - seat.paid.0);
        if seat.paid.0 > 0 {
            self.credit(&who, seat.paid.0);
        }
        emit("veil_seat_left", json!({ "match": match_id, "account": who }));
    }

    /// Start the match: the host can start any time with AI filling the empty seats; anyone can
    /// start a full lobby. Attach NEAR for the OutLayer run (unused deposit is refunded).
    #[payable]
    pub fn start(&mut self, match_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit > NearToken::from_yoctonear(0), "attach NEAR for the enclave run");
        let m = self.get_mut(match_id);
        require!(m.status == Status::Lobby, "not in lobby");
        let humans = m.seats.len();
        require!(humans >= 1, "nobody is seated");
        let full = humans + m.ai_seats as usize >= m.max_seats as usize;
        require!(full || caller == m.host, "only the host can start before the lobby is full");
        let ai = (m.ai_seats as usize).max(MIN_SEATS.saturating_sub(humans));
        let buy_in = match &m.mode {
            Mode::Stakes { buy_in } => buy_in.0,
            Mode::Practice => 0,
        };
        for k in 0..ai {
            let account = warlord_id(k + 1);
            // In Stakes a warlord buys in from its own treasury if it can afford it; a broke
            // warlord still plays, but can't win prize money.
            let mut paid = 0;
            if buy_in > 0 {
                let mut book = self.warlords.get(&account).cloned().unwrap_or_default();
                if book.treasury.0 >= buy_in {
                    book.treasury = U128(book.treasury.0 - buy_in);
                    book.staked = U128(book.staked.0 + buy_in);
                    self.warlords.insert(account.clone(), book);
                    paid = buy_in;
                }
            }
            let m = self.matches.get_mut(&match_id).unwrap();
            m.pot = U128(m.pot.0 + paid);
            m.seats.push(Seat { account, view_pk: AI_VIEW_PK.into(), ai: true, autopilot: false, missed: 0, alive: true, paid: U128(paid) });
        }
        let m = self.matches.get_mut(&match_id).unwrap();
        m.status = Status::Starting;
        let input = json!({
            "op": "init",
            "match_id": match_id,
            "seats": m.seats.iter().map(|s| json!({ "account": s.account, "view_pk": s.view_pk, "ai": s.ai })).collect::<Vec<_>>(),
            "config": { "max_turns": m.max_turns },
        });
        let (project, version) = (m.engine_project.clone(), m.engine_version.clone());
        self.run_engine(match_id, "init", 0, &project, version, input, deposit, caller)
    }

    // ---------------------------------------------------------------- turns

    /// Store this turn's order ciphertext (latest wins until the deadline). The contents are
    /// unreadable to everyone but the enclave.
    pub fn submit_orders(&mut self, match_id: u64, turn: u32, ct_b64: String) {
        let who = env::predecessor_account_id();
        require!(ct_b64.len() <= MAX_ORDERS_B64, "ciphertext too large");
        let now = env::block_timestamp_ms();
        let m = self.matches.get(&match_id).expect("no such match");
        require!(m.status == Status::Running, "not accepting orders");
        require!(turn == m.turn, "wrong turn");
        require!(now < m.deadline_ms, "turn deadline passed");
        let seat = m.seats.iter().find(|s| s.account == who).expect("not seated");
        require!(!seat.ai && seat.alive, "seat cannot submit");
        // The event carries the ciphertext so it stays in chain history for The Reveal check.
        emit("veil_orders_submitted", json!({ "match": match_id, "turn": turn, "seat": who, "ct": ct_b64 }));
        self.orders.insert((match_id, who), ct_b64);
    }

    /// Resolve the current turn once the deadline passed or every human submitted. Anyone may
    /// crank it (the VEIL relayer does); attach NEAR for the enclave run.
    #[payable]
    pub fn resolve_turn(&mut self, match_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit > NearToken::from_yoctonear(0), "attach NEAR for the enclave run");
        let now = env::block_timestamp_ms();
        let m = self.matches.get(&match_id).expect("no such match").clone();
        require!(m.status == Status::Running, "not running");
        let waiting: Vec<&Seat> = m.seats.iter().filter(|s| s.alive && !s.ai && !s.autopilot).collect();
        let all_in = waiting.iter().all(|s| self.orders.contains_key(&(match_id, s.account.clone())));
        require!(now >= m.deadline_ms || all_in, "turn still open");

        let mut seats_in = Vec::new();
        let mut seats = m.seats.clone();
        for s in seats.iter_mut() {
            let ct = self.orders.get(&(match_id, s.account.clone())).cloned();
            if s.alive && !s.ai && !s.autopilot {
                if ct.is_some() {
                    s.missed = 0;
                } else {
                    s.missed = s.missed.saturating_add(1);
                    if s.missed >= AUTOPILOT_AFTER {
                        s.autopilot = true;
                        emit("veil_autopilot", json!({ "match": match_id, "account": s.account }));
                    }
                }
            }
            let ai = s.ai || s.autopilot;
            seats_in.push(json!({
                "account": s.account,
                "view_pk": s.view_pk,
                "ai": ai,
                "orders_ct": if ai { None } else { ct },
            }));
        }
        let mm = self.get_mut(match_id);
        mm.seats = seats;
        mm.status = Status::Resolving;
        let input = json!({ "op": "resolve", "match_id": match_id, "turn": m.turn, "seats": seats_in });
        self.run_engine(match_id, "resolve", m.turn, &m.engine_project, m.engine_version.clone(), input, deposit, caller)
    }

    /// Ask the enclave to publish the full plaintext history of a finished match.
    #[payable]
    pub fn reveal(&mut self, match_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(deposit > NearToken::from_yoctonear(0), "attach NEAR for the enclave run");
        let m = self.get_mut(match_id);
        require!(m.status == Status::Finished, "match not finished (or already revealed)");
        m.status = Status::Revealing;
        let (project, version) = (m.engine_project.clone(), m.engine_version.clone());
        let input = json!({ "op": "reveal", "match_id": match_id });
        self.run_engine(match_id, "reveal", 0, &project, version, input, deposit, caller)
    }

    pub fn claim_seat_back(&mut self, match_id: u64) {
        let who = env::predecessor_account_id();
        let m = self.get_mut(match_id);
        let s = m.seats.iter_mut().find(|s| s.account == who && !s.ai).expect("not seated");
        require!(s.autopilot, "seat is not on autopilot");
        s.autopilot = false;
        s.missed = 0;
        emit("veil_seat_reclaimed", json!({ "match": match_id, "account": who }));
    }

    /// Lost your session key? Register a new one; it takes effect from the next resolved turn.
    pub fn rotate_view_pk(&mut self, match_id: u64, view_pk: String) {
        require!(parse_hex32(&view_pk).is_some(), "view_pk must be 32 bytes of hex");
        let who = env::predecessor_account_id();
        let m = self.get_mut(match_id);
        let s = m.seats.iter_mut().find(|s| s.account == who && !s.ai).expect("not seated");
        s.view_pk = view_pk;
    }

    /// Liveness valve: a lobby that never started, or a match whose engine keeps failing,
    /// is cancelled and every buy-in refunded.
    pub fn cancel_stale(&mut self, match_id: u64) {
        let now = env::block_timestamp_ms();
        let m = self.matches.get(&match_id).expect("no such match").clone();
        let stale_lobby = m.status == Status::Lobby && now >= m.created_ms + STALE_LOBBY_MS;
        let broken = matches!(m.status, Status::Running | Status::Resolving | Status::Starting) && m.failures >= MAX_FAILURES;
        require!(stale_lobby || broken, "match is not stale");
        for s in &m.seats {
            if s.paid.0 > 0 {
                self.credit(&s.account, s.paid.0);
            }
        }
        let mm = self.get_mut(match_id);
        mm.status = Status::Cancelled;
        mm.pot = U128(0);
        emit("veil_match_cancelled", json!({ "match": match_id }));
    }

    // ---------------------------------------------------------------- engine

    #[allow(clippy::too_many_arguments)]
    fn run_engine(
        &self,
        match_id: u64,
        op: &str,
        turn: u32,
        project: &str,
        version: Option<String>,
        input: Value,
        deposit: NearToken,
        payer: AccountId,
    ) -> Promise {
        let args = json!({
            "source": engine_source(project, version),
            "resource_limits": { "max_instructions": 100_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60 },
            "input_data": input.to_string(),
            "response_format": "Json",
            "payer_account_id": payer,
        });
        let gas = env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(CALLBACK_GAS).saturating_sub(RESERVE_GAS);
        Promise::new(self.outlayer.clone())
            .function_call("request_execution".to_string(), args.to_string().into_bytes(), deposit, gas)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_engine_result(match_id, op.into(), turn))
    }

    #[private]
    pub fn on_engine_result(&mut self, match_id: u64, op: String, turn: u32, #[callback_result] result: Result<Value, PromiseError>) {
        let out = result.ok().filter(|v| v.get("ok") == Some(&Value::Bool(true)));
        self.apply_engine_output(match_id, &op, turn, out);
    }

    fn verify_vrf(&self, v: &Value, seed: &str) -> Option<Vrf> {
        let vrf: Vrf = serde_json::from_value(v.clone()).ok()?;
        if !vrf.alpha.starts_with("vrf:") || !vrf.alpha.ends_with(&format!(":{seed}")) {
            return None;
        }
        let sig: [u8; 64] = hex::decode(&vrf.signature_hex).ok()?.try_into().ok()?;
        if hex::encode(env::sha256(&sig)) != vrf.output_hex {
            return None;
        }
        env::ed25519_verify(&sig, vrf.alpha.as_bytes(), &self.vrf_pubkey).then_some(vrf)
    }

    /// Apply what the enclave said. Anything missing or unverifiable is treated as a failed run.
    pub(crate) fn apply_engine_output(&mut self, id: u64, op: &str, turn: u32, out: Option<Value>) {
        let now = env::block_timestamp_ms();
        let m = self.matches.get(&id).expect("no such match").clone();
        let seed = match op {
            "init" => format!("init-{id}"),
            "resolve" => format!("turn-{turn}"),
            _ => String::new(),
        };
        let vrf = match (&out, op) {
            (Some(o), "init" | "resolve") => self.verify_vrf(&o["vrf"], &seed),
            _ => None,
        };
        let ok = match (op, &out) {
            ("reveal", Some(o)) => o["hash"].is_string(),
            (_, Some(o)) => vrf.is_some() && o["turn"].as_u64() == Some(turn as u64) && o["state_commit"].is_string(),
            _ => false,
        };
        let expected = match op {
            "init" => Status::Starting,
            "resolve" => Status::Resolving,
            _ => Status::Revealing,
        };
        if m.status != expected || (op == "resolve" && m.turn != turn) {
            return; // A stale callback; nothing to do.
        }

        if !ok {
            let mm = self.get_mut(id);
            mm.failures = mm.failures.saturating_add(1);
            match op {
                "init" => {
                    let refunds: Vec<(AccountId, u128)> = mm.seats.iter().filter(|s| s.ai && s.paid.0 > 0).map(|s| (s.account.clone(), s.paid.0)).collect();
                    mm.seats.retain(|s| !s.ai);
                    mm.pot = U128(mm.pot.0 - refunds.iter().map(|r| r.1).sum::<u128>());
                    mm.status = Status::Lobby;
                    for (w, amt) in refunds {
                        let mut book = self.warlords.get(&w).cloned().unwrap_or_default();
                        book.treasury = U128(book.treasury.0 + amt);
                        book.staked = U128(book.staked.0 - amt);
                        self.warlords.insert(w, book);
                    }
                    emit("veil_engine_retry", json!({ "match": id, "op": op, "turn": turn }));
                    return;
                }
                "resolve" => {
                    mm.status = Status::Running;
                    mm.deadline_ms = now + RETRY_DELAY_MS;
                }
                _ => mm.status = Status::Finished,
            }
            emit("veil_engine_retry", json!({ "match": id, "op": op, "turn": turn, "failures": mm.failures }));
            return;
        }
        let out = out.unwrap();

        if op == "reveal" {
            let mm = self.get_mut(id);
            mm.reveal_hash = out["hash"].as_str().map(String::from);
            mm.reveal_key = out["key"].as_str().map(String::from);
            mm.status = Status::Revealed;
            emit("veil_revealed", json!({ "match": id, "hash": out["hash"], "key": out["key"], "chunks": out["chunks"] }));
            return;
        }

        // Views: human seats only.
        for s in m.seats.iter().filter(|s| !s.ai) {
            if let Some(ct) = out["views"][s.account.as_str()].as_str() {
                self.views.insert((id, s.account.clone()), ViewRec { turn, ct: ct.to_string() });
            }
        }
        let state_commit = out["state_commit"].as_str().unwrap().to_string();
        self.history.insert(
            (id, turn),
            PublicTurn { turn, public: out["public"].to_string(), state_commit: state_commit.clone(), vrf: vrf.unwrap(), resolved_ms: now },
        );
        // This turn's ciphertexts are no longer needed in state (they are in the event log).
        for s in &m.seats {
            self.orders.remove(&(id, s.account.clone()));
        }

        let public = &out["public"];
        let game_over = public["game_over"].as_bool().unwrap_or(false);
        let eliminated: Vec<u64> = public["eliminated"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64()).collect()).unwrap_or_default();
        let ranking: Option<Vec<u8>> = public["ranking"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64().map(|v| v as u8)).collect());

        let mm = self.get_mut(id);
        mm.failures = 0;
        mm.state_commit = Some(state_commit);
        for e in &eliminated {
            if let Some(s) = mm.seats.get_mut(*e as usize) {
                s.alive = false;
            }
        }
        if op == "init" {
            mm.game_pk = out["game_pk"].as_str().map(String::from);
            mm.status = Status::Running;
            mm.turn = 1;
            mm.deadline_ms = now + mm.turn_len_ms;
            emit("veil_match_started", json!({ "match": id, "game_pk": mm.game_pk, "deadline_ms": mm.deadline_ms }));
            return;
        }
        emit("veil_turn_resolved", json!({ "match": id, "turn": turn, "battles": public["battles"], "eliminated": eliminated }));
        if !game_over {
            mm.turn += 1;
            mm.status = Status::Running;
            mm.deadline_ms = now + mm.turn_len_ms;
            return;
        }
        mm.status = Status::Finished;
        mm.ranking = ranking.clone();
        let mut payouts: Vec<(AccountId, U128)> = Vec::new();
        if let (Mode::Stakes { .. }, Some(r)) = (&m.mode, &ranking) {
            let pot = m.pot.0;
            let rake = pot * self.rake_bps as u128 / 10_000;
            let prize = pot - rake;
            // AI seats pay nothing and win nothing: prizes go to paying seats in rank order.
            let paying: Vec<AccountId> =
                r.iter().filter_map(|&i| m.seats.get(i as usize)).filter(|s| s.paid.0 > 0).map(|s| s.account.clone()).collect();
            let split = shares(paying.len());
            let winners = split.len().min(paying.len());
            let mut paid = 0u128;
            for (k, acc) in paying.iter().take(winners).enumerate() {
                let amt = if k + 1 == winners { prize - paid } else { prize * split[k] / 10_000 };
                paid += amt;
                payouts.push((acc.clone(), U128(amt)));
            }
            self.rake += rake;
        }
        for (acc, amt) in &payouts {
            self.credit(acc, amt.0);
            if is_warlord(acc) {
                let mut book = self.warlords.get(acc).cloned().unwrap_or_default();
                book.earned = U128(book.earned.0 + amt.0);
                self.warlords.insert(acc.clone(), book);
            }
        }
        for (i, seat) in m.seats.iter().enumerate().filter(|(_, s)| s.ai) {
            let mut book = self.warlords.get(&seat.account).cloned().unwrap_or_default();
            book.played += 1;
            if ranking.as_ref().and_then(|r| r.first()) == Some(&(i as u8)) {
                book.won += 1;
            }
            self.warlords.insert(seat.account.clone(), book);
        }
        self.get_mut(id).payouts = payouts.clone();
        emit("veil_match_finished", json!({ "match": id, "ranking": ranking, "payouts": payouts }));
    }

    // ---------------------------------------------------------------- money out

    fn credit(&mut self, who: &AccountId, amount: u128) {
        if is_warlord(who) {
            let mut book = self.warlords.get(who).cloned().unwrap_or_default();
            book.treasury = U128(book.treasury.0 + amount);
            self.warlords.insert(who.clone(), book);
            return;
        }
        let cur = self.balances.get(who).copied().unwrap_or(0);
        self.balances.insert(who.clone(), cur + amount);
    }

    /// Withdraw refunds and winnings (USDC) to your account. From there the client offers
    /// "withdraw anywhere" through NEAR Intents 1Click, confidentially.
    pub fn claim(&mut self) -> Promise {
        self.claim_for(env::predecessor_account_id())
    }

    fn claim_for(&mut self, who: AccountId) -> Promise {
        let amount = self.balances.remove(&who).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        Promise::new(self.usdc.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": who, "amount": U128(amount) }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_claim(who, U128(amount)))
    }

    #[private]
    pub fn on_claim(&mut self, who: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.credit(&who, amount.0);
        }
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            outlayer: self.outlayer.clone(),
            engine_project: self.engine_project.clone(),
            engine_version: self.engine_version.clone(),
            vrf_pubkey: hex::encode(self.vrf_pubkey),
            usdc: self.usdc.clone(),
            rake_bps: self.rake_bps,
            rake: U128(self.rake),
        }
    }

    pub fn get_match(&self, match_id: u64) -> Option<Match> {
        self.matches.get(&match_id).cloned()
    }

    pub fn get_matches(&self, from_id: Option<u64>, limit: Option<u32>) -> Vec<Match> {
        let from = from_id.unwrap_or(1);
        let limit = limit.unwrap_or(50).min(100) as u64;
        (from..self.next_id).take(limit as usize).filter_map(|i| self.matches.get(&i).cloned()).collect()
    }

    pub fn get_open_lobbies(&self) -> Vec<Match> {
        let start = self.next_id.saturating_sub(200).max(1);
        (start..self.next_id).filter_map(|i| self.matches.get(&i)).filter(|m| m.status == Status::Lobby).cloned().collect()
    }

    pub fn get_view(&self, match_id: u64, account: AccountId) -> Option<ViewOut> {
        self.views.get(&(match_id, account)).map(|v| ViewOut { turn: v.turn, ciphertext: v.ct.clone() })
    }

    pub fn get_history(&self, match_id: u64, from: u32, limit: u32) -> Vec<PublicTurn> {
        (from..from.saturating_add(limit.min(60))).map_while(|t| self.history.get(&(match_id, t)).cloned()).collect()
    }

    /// Which seats have submitted this turn (not what).
    pub fn get_submitted(&self, match_id: u64) -> Vec<AccountId> {
        let Some(m) = self.matches.get(&match_id) else { return vec![] };
        m.seats.iter().filter(|s| self.orders.contains_key(&(match_id, s.account.clone()))).map(|s| s.account.clone()).collect()
    }

    /// Every warlord's wallet: treasury, record, all-time stakes and winnings.
    pub fn get_warlords(&self) -> Vec<(AccountId, WarlordBook)> {
        (1..=MAX_WARLORDS).map(|k| { let id = warlord_id(k); let b = self.warlords.get(&id).cloned().unwrap_or_default(); (id, b) }).collect()
    }

    pub fn get_balance(&self, account: AccountId) -> U128 {
        U128(self.balances.get(&account).copied().unwrap_or(0))
    }
}

#[cfg(test)]
mod tests;

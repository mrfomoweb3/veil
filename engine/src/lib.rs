//! The VEIL engine: the program that runs inside the OutLayer TEE.
//!
//! It reads one JSON request on stdin and writes one JSON answer on stdout. Three ops:
//! `init` (map, game key, opening views), `resolve` (one turn), `reveal` (publish history).
//! All match state is sealed; every view leaves encrypted to its player's key.

pub mod ai;
pub mod host;
pub mod records;

#[cfg(feature = "local")]
pub mod local;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use host::Host;
use records::{commit, InitRecord, MatchRecord, RevealDoc, TurnRecord};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use veil_crypto::{game_secret, open, orders_aad, public_key, seal, view_aad, INFO_ORDERS, INFO_VIEW};
use veil_rules::orders::ORDER_ALL;
use veil_rules::state::{MAX_SEATS, MIN_SEATS};
use veil_rules::{build_view, generate, resolve, Config, Feedback, Issue, Orders, Personality, PublicTurn};

/// The only contract allowed to drive this build, fixed at compile time (also enforced by the
/// manifest's `callers` block). Unset for local development builds.
pub const EXPECTED_CALLER: Option<&str> = option_env!("VEIL_CONTRACT");
pub const REVEAL_CHUNK: usize = 60_000;
pub const MAX_ORDERS_CT: usize = 2048;
/// Whole-turn budget for LLM warlords; after it, remaining AI seats use the heuristic bot.
pub const AI_TURN_BUDGET_MS: u64 = 25_000;

#[derive(Deserialize)]
pub struct SeatIn {
    pub account: String,
    pub view_pk: String,
    #[serde(default)]
    pub orders_ct: Option<String>,
    #[serde(default)]
    pub ai: bool,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Init {
        match_id: u64,
        seats: Vec<SeatIn>,
        #[serde(default)]
        config: Option<Config>,
    },
    Resolve {
        match_id: u64,
        turn: u32,
        seats: Vec<SeatIn>,
    },
    Reveal {
        match_id: u64,
    },
}

/// Run one request. Never panics on bad input: every failure is `{"ok": false, "error": …}`.
pub fn run(host: &mut impl Host, input: &[u8]) -> Value {
    if let Some(expected) = EXPECTED_CALLER {
        if host.env("NEAR_PREDECESSOR_ID").as_deref() != Some(expected) {
            return json!({ "ok": false, "error": "this engine only runs for its game contract" });
        }
    }
    let req: Request = match serde_json::from_slice(input) {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": format!("bad request: {e}") }),
    };
    let res = match req {
        Request::Init { match_id, seats, config } => init(host, match_id, &seats, config.unwrap_or_default()),
        Request::Resolve { match_id, turn, seats } => resolve_turn(host, match_id, turn, &seats),
        Request::Reveal { match_id } => reveal(host, match_id),
    };
    res.unwrap_or_else(|e| json!({ "ok": false, "error": e }))
}

fn cur_key(id: u64) -> String {
    format!("m:{id}:cur")
}

fn game_keys(host: &mut impl Host, id: u64) -> Result<([u8; 32], [u8; 32]), String> {
    let mac = host.mac("orders", format!("game-sk:v1:{id}").as_bytes())?;
    let sk = game_secret(&mac);
    Ok((sk, public_key(&sk)))
}

fn commit_salt(host: &mut impl Host, id: u64) -> Result<Vec<u8>, String> {
    host.mac("state", format!("commit-salt:v1:{id}").as_bytes())
}

fn parse_pk(hex_pk: &str) -> Result<[u8; 32], String> {
    hex::decode(hex_pk)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| "view_pk must be 32 bytes of hex".to_string())
}

fn seal_views(
    host: &mut impl Host,
    id: u64,
    turn: u32,
    seats: &[SeatIn],
    plaintexts: Vec<Vec<u8>>,
) -> Result<Map<String, Value>, String> {
    let mut views = Map::new();
    for (seat, pt) in seats.iter().zip(plaintexts) {
        let pk = parse_pk(&seat.view_pk)?;
        let ent = host.entropy();
        let ct = seal(&pk, &pt, &view_aad(id, turn, &seat.account), INFO_VIEW, &ent);
        views.insert(seat.account.clone(), Value::String(B64.encode(ct)));
    }
    Ok(views)
}

fn load(host: &mut impl Host, id: u64) -> Result<(MatchRecord, Vec<u8>), String> {
    let (pt, stored) = host.sealed_get(&cur_key(id))?.ok_or("no such match")?;
    let rec: MatchRecord = serde_json::from_slice(&pt).map_err(|e| format!("corrupt match record: {e}"))?;
    Ok((rec, stored))
}

fn init(host: &mut impl Host, id: u64, seats: &[SeatIn], config: Config) -> Result<Value, String> {
    if !(MIN_SEATS..=MAX_SEATS).contains(&seats.len()) {
        return Err(format!("a match needs {MIN_SEATS}–{MAX_SEATS} seats"));
    }
    let accounts: Vec<String> = seats.iter().map(|s| s.account.clone()).collect();
    for (i, a) in accounts.iter().enumerate() {
        if accounts[..i].contains(a) {
            return Err("duplicate seat".into());
        }
    }
    for s in seats {
        parse_pk(&s.view_pk)?;
    }
    if config.max_turns == 0 || config.max_turns > 100 {
        return Err("max_turns out of range".into());
    }
    let vrf = host.vrf(&format!("init-{id}"))?;
    let mut state = generate(id, seats.len(), config, vrf.seed()?);
    // AI seats are warlords: they sell intel and truces, priced by their own AI.
    for (p, s) in seats.iter().enumerate() {
        state.players[p].warlord = s.ai;
    }
    let salt = commit_salt(host, id)?;
    let state_commit = commit(&salt, &state);
    let rec = MatchRecord { accounts, state: state.clone(), state_commit: state_commit.clone() };
    if !host.sealed_insert(&cur_key(id), &serde_json::to_vec(&rec).unwrap())? {
        return Err("match already initialized".into());
    }
    let init = InitRecord { vrf: vrf.clone(), state: state.clone(), state_commit: state_commit.clone() };
    host.sealed_insert(&format!("m:{id}:init"), &serde_json::to_vec(&init).unwrap())?;

    let (_, game_pk) = game_keys(host, id)?;
    let pts = (0..seats.len() as u8).map(|p| build_view(&state, p, None, &[]).encode()).collect();
    let views = seal_views(host, id, 0, seats, pts)?;
    Ok(json!({
        "ok": true,
        "op": "init",
        "match_id": id,
        "turn": 0,
        "game_pk": hex::encode(game_pk),
        "public": PublicTurn::opening(&state),
        "views": views,
        "vrf": vrf,
        "state_commit": state_commit,
    }))
}

fn resolve_turn(host: &mut impl Host, id: u64, turn: u32, seats: &[SeatIn]) -> Result<Value, String> {
    let (rec, stored) = load(host, id)?;
    let mut state = rec.state.clone();
    if state.game_over {
        return Err("match is over".into());
    }
    if turn != state.turn {
        return Err(format!("expected turn {}, got {turn}", state.turn));
    }
    if seats.len() != rec.accounts.len() || seats.iter().zip(&rec.accounts).any(|(s, a)| &s.account != a) {
        return Err("seats do not match this match".into());
    }
    let (game_sk, _) = game_keys(host, id)?;
    let started = host.now_ms();

    let n = seats.len();
    let mut orders = vec![Orders::default(); n];
    let mut extra: Vec<Vec<Feedback>> = vec![Vec::new(); n];
    let mut submitted = vec![false; n];
    let mut llm = vec![false; n];
    for (p, seat) in seats.iter().enumerate() {
        if !state.players[p].alive {
            continue;
        }
        if seat.ai {
            let view = build_view(&state, p as u8, None, &[]);
            let (o, used_llm) =
                ai::ai_orders(host, &view, Personality::for_account(&seat.account, p as u8), started + AI_TURN_BUDGET_MS);
            orders[p] = o;
            llm[p] = used_llm;
            continue;
        }
        match &seat.orders_ct {
            None => extra[p].push(Feedback { issue: Issue::Missed, order: ORDER_ALL }),
            Some(ct) => {
                submitted[p] = true;
                let parsed = B64
                    .decode(ct)
                    .ok()
                    .filter(|b| b.len() <= MAX_ORDERS_CT)
                    .and_then(|b| open(&game_sk, &b, &orders_aad(id, turn, &seat.account), INFO_ORDERS).ok())
                    .and_then(|pt| Orders::from_padded(&pt));
                match parsed {
                    Some(o) => orders[p] = o,
                    None => extra[p].push(Feedback { issue: Issue::Unreadable, order: ORDER_ALL }),
                }
            }
        }
    }

    let vrf = host.vrf(&format!("turn-{turn}"))?;
    let outcome = resolve(&mut state, &orders, vrf.seed()?);
    let public = PublicTurn::after(&state, &outcome);
    let salt = commit_salt(host, id)?;
    let state_commit = commit(&salt, &state);

    let next = MatchRecord { accounts: rec.accounts.clone(), state: state.clone(), state_commit: state_commit.clone() };
    if !host.sealed_replace(&cur_key(id), &stored, &serde_json::to_vec(&next).unwrap())? {
        return Err("turn already resolved by a concurrent run".into());
    }
    let record = TurnRecord {
        turn,
        orders,
        submitted,
        ai: seats.iter().map(|s| s.ai).collect(),
        llm,
        vrf: vrf.clone(),
        public: public.clone(),
        state_commit: state_commit.clone(),
    };
    host.sealed_insert(&format!("m:{id}:t:{turn}"), &serde_json::to_vec(&record).unwrap())?;

    let pts = (0..n as u8).map(|p| build_view(&state, p, Some(&outcome), &extra[p as usize]).encode()).collect();
    let views = seal_views(host, id, turn, seats, pts)?;
    Ok(json!({
        "ok": true,
        "op": "resolve",
        "match_id": id,
        "turn": turn,
        "public": public,
        "views": views,
        "vrf": vrf,
        "state_commit": state_commit,
    }))
}

fn reveal(host: &mut impl Host, id: u64) -> Result<Value, String> {
    let (rec, _) = load(host, id)?;
    if !rec.state.game_over {
        return Err("the match is still running".into());
    }
    let (ipt, _) = host.sealed_get(&format!("m:{id}:init"))?.ok_or("missing init record")?;
    let init: InitRecord = serde_json::from_slice(&ipt).map_err(|e| e.to_string())?;
    let mut turns = Vec::new();
    for t in 1..rec.state.turn {
        let (pt, _) = host.sealed_get(&format!("m:{id}:t:{t}"))?.ok_or(format!("missing turn {t}"))?;
        turns.push(serde_json::from_slice::<TurnRecord>(&pt).map_err(|e| e.to_string())?);
    }
    let (game_sk, game_pk) = game_keys(host, id)?;
    let doc = RevealDoc {
        version: 1,
        match_id: id,
        accounts: rec.accounts.clone(),
        game_sk_hex: hex::encode(game_sk),
        game_pk_hex: hex::encode(game_pk),
        commit_salt_hex: hex::encode(commit_salt(host, id)?),
        init,
        turns,
        final_state: rec.state,
    };
    let bytes = serde_json::to_vec(&doc).unwrap();
    let hash = veil_crypto::sha256_hex(&bytes);
    let chunks: Vec<&[u8]> = bytes.chunks(REVEAL_CHUNK).collect();
    for (k, c) in chunks.iter().enumerate() {
        host.public_set(&format!("reveal:{id}:{k}"), c)?;
    }
    let index = json!({ "match_id": id, "hash": hash, "chunks": chunks.len(), "bytes": bytes.len() });
    host.public_set(&format!("reveal:{id}"), index.to_string().as_bytes())?;
    Ok(json!({
        "ok": true,
        "op": "reveal",
        "match_id": id,
        "hash": hash,
        "key": format!("reveal:{id}"),
        "chunks": chunks.len(),
        "bytes": bytes.len(),
    }))
}

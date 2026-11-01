//! In-browser verification and replay of a revealed match.
//!
//! ```text
//! ptr = alloc(n); write the reveal JSON at ptr
//! out = replay(ptr, n, pk_ptr, pk_len)      // pk: VRF public key as hex (may be empty)
//! len = u32 little-endian at out; JSON result at out + 4; then dealloc(out, len + 4)
//! ```

use serde::Serialize;
use serde_json::json;
use veil_engine::records::RevealDoc;
use veil_rules::{resolve, GameState, PublicTurn};

#[derive(Serialize)]
struct Frame {
    turn: u32,
    owners: Vec<i16>,
    troops: Vec<u32>,
    forts: Vec<bool>,
    alive: Vec<bool>,
    aether: Vec<u32>,
    public: Option<PublicTurn>,
}

fn frame(turn: u32, s: &GameState, public: Option<PublicTurn>) -> Frame {
    Frame {
        turn,
        owners: s.tiles.iter().map(|t| t.owner.map(|o| o as i16).unwrap_or(-1)).collect(),
        troops: s.tiles.iter().map(|t| t.troops).collect(),
        forts: s.tiles.iter().map(|t| t.fort).collect(),
        alive: s.players.iter().map(|p| p.alive).collect(),
        aether: s.players.iter().map(|p| p.aether).collect(),
        public,
    }
}

pub fn replay_json(doc: &[u8], vrf_pubkey_hex: &str) -> String {
    let doc: RevealDoc = match serde_json::from_slice(doc) {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "errors": [format!("not a reveal document: {e}")] }).to_string(),
    };
    let pk: Option<[u8; 32]> = hex::decode(vrf_pubkey_hex).ok().and_then(|b| b.try_into().ok());
    let report = veil_verify::verify(&doc, pk.as_ref(), None, &[]);
    let mut state = doc.init.state.clone();
    let mut frames = vec![frame(0, &state, None)];
    for t in &doc.turns {
        let Ok(seed) = t.vrf.seed() else { break };
        if t.orders.len() != state.players.len() {
            break;
        }
        let out = resolve(&mut state, &t.orders, seed);
        frames.push(frame(t.turn, &state, Some(PublicTurn::after(&state, &out))));
    }
    json!({
        "ok": report.ok(),
        "errors": report.errors,
        "turns_checked": report.turns_checked,
        "vrf_checked": pk.is_some(),
        "match_id": doc.match_id,
        "accounts": doc.accounts,
        "radius": doc.init.state.radius,
        "terrain": doc.init.state.tiles.iter().map(|t| t.terrain as u8).collect::<Vec<_>>(),
        "frames": frames,
        "orders": doc.turns.iter().map(|t| &t.orders).collect::<Vec<_>>(),
        "llm": doc.turns.iter().map(|t| &t.llm).collect::<Vec<_>>(),
        "ranking": state.ranking(),
        "game_pk": doc.game_pk_hex,
    })
    .to_string()
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `alloc` or `replay`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// # Safety
/// The pointers must address `len` readable bytes allocated with `alloc`.
#[no_mangle]
pub unsafe extern "C" fn replay(doc: *const u8, doc_len: usize, pk: *const u8, pk_len: usize) -> *mut u8 {
    let doc = std::slice::from_raw_parts(doc, doc_len);
    let pk = std::str::from_utf8(std::slice::from_raw_parts(pk, pk_len)).unwrap_or("");
    let out = replay_json(doc, pk).into_bytes();
    let mut buf = Vec::with_capacity(out.len() + 4);
    buf.extend_from_slice(&(out.len() as u32).to_le_bytes());
    buf.extend_from_slice(&out);
    let p = buf.as_mut_ptr();
    std::mem::forget(buf);
    p
}

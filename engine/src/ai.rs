//! AI warlords. Runs inside the enclave, so the model provably receives exactly one seat's
//! fog view and nothing else. Any failure, delay or nonsense falls back to the heuristic bot:
//! the game never waits on the AI.

use crate::host::Host;
use serde_json::{json, Value};
use veil_rules::{bot_orders, legal_moves, Orders, Personality, PlayerView};

pub const NEARAI_URL: &str = "https://cloud-api.near.ai/v1/chat/completions";
pub const DEFAULT_MODEL: &str = "zai-org/GLM-5.1-FP8";
const CALL_TIMEOUT_MS: u64 = 12_000;

/// Orders for an AI seat, and whether they came from the LLM.
pub fn ai_orders(host: &mut impl Host, view: &PlayerView, personality: Personality, deadline_ms: u64) -> (Orders, bool) {
    let fallback = bot_orders(view, personality);
    let Some(key) = host.env("NEARAI_API_KEY").filter(|k| !k.is_empty()) else {
        return (fallback, false);
    };
    let now = host.now_ms();
    if now + 2_000 >= deadline_ms {
        return (fallback, false);
    }
    let model = host.env("NEARAI_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let body = json!({
        "model": model,
        "temperature": 0.4,
        "max_tokens": 600,
        "messages": [
            { "role": "system", "content": system_prompt(personality) },
            { "role": "user", "content": user_prompt(view, &fallback) },
        ],
    })
    .to_string();
    let auth = format!("Bearer {key}");
    let timeout = CALL_TIMEOUT_MS.min(deadline_ms - now);
    let reply = host.http_post(
        NEARAI_URL,
        &[("Authorization", auth.as_str()), ("Content-Type", "application/json")],
        &body,
        timeout,
    );
    match reply.ok().and_then(|r| parse_reply(&r)) {
        Some(o) => (o, true),
        None => (fallback, false),
    }
}

fn system_prompt(p: Personality) -> String {
    format!(
        "You are {}, a warlord in VEIL: a simultaneous-turn strategy game on floating hex islands \
covered by cloud (fog of war). Coordinates are axial [q, r]. Each turn you may: move troops one \
step from your tile to an adjacent passable tile (max 6 moves), recruit up to 10 troops at your \
capital (1 aether each), build one fort (6 aether, ×1.5 defense), send one scout up to 3 steps \
(2 aether, reveals radius 2). Defense: forest ×1.25, highland ×1.15, capital ×1.5. Losing your \
capital eliminates you. The player holding the most tiles after 20 turns wins. \
Reply with ONLY a JSON object: {{\"moves\":[{{\"from\":[q,r],\"to\":[q,r],\"count\":n}}],\
\"recruit\":n,\"fort\":[q,r] or null,\"scout\":[[q,r],...] or null}}",
        p.title()
    )
}

fn user_prompt(view: &PlayerView, baseline: &Orders) -> String {
    let board = view.board();
    let tiles: Vec<Value> = view
        .tiles
        .iter()
        .map(|t| {
            let h = board.hex(t.index as usize);
            json!([h.0, h.1, format!("{:?}", t.terrain).to_lowercase(), t.owner, t.troops, t.fort])
        })
        .collect();
    let cap = board.hex(view.capital as usize);
    json!({
        "turn": view.turn + 1,
        "you": view.me,
        "aether": view.aether,
        "income": view.income,
        "capital": [cap.0, cap.1],
        "scoreboard_tiles": view.seats.iter().map(|s| if s.alive { s.tiles as i64 } else { -1 }).collect::<Vec<_>>(),
        "visible_tiles_[q,r,terrain,owner,troops,fort]": tiles,
        "legal_moves": legal_moves(view).iter().map(|m| json!([[m.from.0, m.from.1], [m.to.0, m.to.1], m.max])).collect::<Vec<_>>(),
        "advisor_suggestion": baseline,
    })
    .to_string()
}

/// Pull an `Orders` object out of a chat completion. Reasoning models may wrap it in prose.
pub fn parse_reply(body: &str) -> Option<Orders> {
    let v: Value = serde_json::from_str(body).ok()?;
    let content = v["choices"][0]["message"]["content"].as_str()?;
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    let orders: Orders = serde_json::from_str(content.get(start..=end)?).ok()?;
    Some(orders)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wrapped_json() {
        let body = json!({ "choices": [{ "message": { "content":
            "Thinking done. {\"moves\":[{\"from\":[0,1],\"to\":[1,1],\"count\":3}],\"recruit\":4,\"fort\":null,\"scout\":null} good luck" } }] })
        .to_string();
        let o = parse_reply(&body).unwrap();
        assert_eq!(o.recruit, 4);
        assert_eq!(o.moves.len(), 1);
        assert!(parse_reply("{}").is_none());
        assert!(parse_reply(&json!({ "choices": [{ "message": { "content": "no" } }] }).to_string()).is_none());
    }
}

//! A whole match through the engine (local host), then The Reveal, then independent verification.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use veil_crypto::{open, orders_aad, public_key, seal, view_aad, INFO_ORDERS, INFO_VIEW};
use veil_engine::local::LocalHost;
use veil_engine::records::RevealDoc;
use veil_rules::{bot_orders, Personality, PlayerView};
use veil_verify::{verify, ChainOrders, ChainTurn};

const CONTRACT: &str = "veil.local";

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("veil-e2e-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

struct Seat {
    account: String,
    sk: [u8; 32],
    ai: bool,
}

fn call(dir: &PathBuf, predecessor: &str, req_id: u64, req: Value) -> Value {
    let mut host = LocalHost::new(dir, predecessor, "cranker.local", &req_id.to_string()).unwrap();
    veil_engine::run(&mut host, req.to_string().as_bytes())
}

fn seats_json(seats: &[Seat], orders: &[Option<String>]) -> Value {
    Value::Array(
        seats
            .iter()
            .zip(orders)
            .map(|(s, o)| json!({ "account": s.account, "view_pk": hex::encode(public_key(&s.sk)), "ai": s.ai, "orders_ct": o }))
            .collect(),
    )
}

fn decrypt_view(id: u64, turn: u32, seat: &Seat, out: &Value) -> PlayerView {
    let ct = B64.decode(out["views"][&seat.account].as_str().unwrap()).unwrap();
    assert_eq!(ct.len(), veil_crypto::OVERHEAD + veil_rules::view::VIEW_PLAINTEXT_LEN, "every view has the same size");
    let pt = open(&seat.sk, &ct, &view_aad(id, turn, &seat.account), INFO_VIEW).expect("my view opens with my key");
    PlayerView::decode(&pt).unwrap()
}

#[test]
fn full_match_reveal_and_verify() {
    let dir = tmp("full");
    let id = 42;
    let seats = vec![
        Seat { account: "alice.near".into(), sk: [1; 32], ai: false },
        Seat { account: "bob.near".into(), sk: [2; 32], ai: false },
        Seat { account: "warlord-1.veil".into(), sk: [3; 32], ai: true },
        Seat { account: "warlord-2.veil".into(), sk: [4; 32], ai: true },
    ];
    let mut req_id = 1;
    let init = call(&dir, CONTRACT, req_id, json!({ "op": "init", "match_id": id, "seats": seats_json(&seats, &[None, None, None, None]), "config": { "max_turns": 12 } }));
    assert_eq!(init["ok"], true, "{init}");
    let game_pk: [u8; 32] = hex::decode(init["game_pk"].as_str().unwrap()).unwrap().try_into().unwrap();

    // Another caller sees nothing: different predecessor, different storage cell and keys.
    let snoop = call(&dir, "mallory.near", 99, json!({ "op": "resolve", "match_id": id, "turn": 1, "seats": seats_json(&seats, &[None, None, None, None]) }));
    assert_eq!(snoop["ok"], false);
    assert_eq!(snoop["error"], "no such match");

    // Seats can't read each other's views.
    let ct = B64.decode(init["views"]["alice.near"].as_str().unwrap()).unwrap();
    assert!(open(&seats[1].sk, &ct, &view_aad(id, 0, "alice.near"), INFO_VIEW).is_err());

    let mut views: Vec<PlayerView> = seats.iter().map(|s| decrypt_view(id, 0, s, &init)).collect();
    let mut chain_turns = vec![ChainTurn {
        public: serde_json::from_value(init["public"].clone()).unwrap(),
        state_commit: init["state_commit"].as_str().unwrap().into(),
        vrf: serde_json::from_value(init["vrf"].clone()).unwrap(),
    }];
    let mut chain_orders = Vec::new();
    let mut turn = 1;
    loop {
        // Humans: alice plays the bot's orders; bob misses every third turn.
        let mut cts: Vec<Option<String>> = vec![None; seats.len()];
        for (p, s) in seats.iter().enumerate() {
            if s.ai || (p == 1 && turn % 3 == 0) {
                continue;
            }
            let mut o = bot_orders(&views[p], Personality::Raider);
            // Alice trades with warlord 2: a truce on even turns, intel on odd ones.
            if p == 0 {
                use veil_rules::orders::{Trade, TradeKind};
                let kind = if turn % 2 == 0 {
                    TradeKind::Truce { turns: 2 }
                } else {
                    TradeKind::Intel { at: views[0].board().hex(0) }
                };
                o.trades.push(Trade { with: 2, kind });
            }
            let pt = o.to_padded().unwrap();
            let ct = seal(&game_pk, &pt, &orders_aad(id, turn, &s.account), INFO_ORDERS, &[turn as u8 ^ p as u8; 56]);
            let b64 = B64.encode(ct);
            chain_orders.push(ChainOrders { turn, account: s.account.clone(), ciphertext_b64: b64.clone() });
            cts[p] = Some(b64);
        }
        req_id += 1;
        let out = call(&dir, CONTRACT, req_id, json!({ "op": "resolve", "match_id": id, "turn": turn, "seats": seats_json(&seats, &cts) }));
        assert_eq!(out["ok"], true, "turn {turn}: {out}");

        // Replaying the same turn is refused (CAS on sealed state).
        req_id += 1;
        let again = call(&dir, CONTRACT, req_id, json!({ "op": "resolve", "match_id": id, "turn": turn, "seats": seats_json(&seats, &cts) }));
        assert_eq!(again["ok"], false);

        views = seats.iter().map(|s| decrypt_view(id, turn, s, &out)).collect();
        if views[0].alive {
            assert!(views[0].seats[2].warlord && views[0].seats[2].truce_price > 0, "warlord prices are public in every view");
            let traded = views[0].feedback.iter().any(|f| matches!(f.issue,
                veil_rules::Issue::TruceBought | veil_rules::Issue::IntelBought | veil_rules::Issue::TradeUnknown | veil_rules::Issue::NotEnoughAether | veil_rules::Issue::TradeRefused));
            assert!(traded, "every trade gets an answer in the buyer's view");
        }
        if turn % 3 == 0 {
            assert!(views[1].feedback.iter().any(|f| f.issue == veil_rules::Issue::Missed));
        }
        chain_turns.push(ChainTurn {
            public: serde_json::from_value(out["public"].clone()).unwrap(),
            state_commit: out["state_commit"].as_str().unwrap().into(),
            vrf: serde_json::from_value(out["vrf"].clone()).unwrap(),
        });
        if out["public"]["game_over"] == true {
            break;
        }
        turn += 1;
        assert!(turn <= 12);
    }

    // Reveal is refused for another caller, allowed for the contract.
    assert_eq!(call(&dir, "mallory.near", 1000, json!({ "op": "reveal", "match_id": id }))["ok"], false);
    let rev = call(&dir, CONTRACT, 1001, json!({ "op": "reveal", "match_id": id }));
    assert_eq!(rev["ok"], true, "{rev}");

    // Reassemble from public storage, exactly as the verifier CLI does.
    let index: Value = serde_json::from_slice(&std::fs::read(dir.join("public").join(format!("reveal:{id}"))).unwrap()).unwrap();
    let mut bytes = Vec::new();
    for k in 0..index["chunks"].as_u64().unwrap() {
        bytes.extend(std::fs::read(dir.join("public").join(format!("reveal:{id}:{k}"))).unwrap());
    }
    assert_eq!(veil_crypto::sha256_hex(&bytes), rev["hash"].as_str().unwrap());
    let doc: RevealDoc = serde_json::from_slice(&bytes).unwrap();
    let pk: [u8; 32] = hex::decode(LocalHost::vrf_public_key(&dir).unwrap()).unwrap().try_into().unwrap();

    let report = verify(&doc, Some(&pk), Some(&chain_turns), &chain_orders);
    assert!(report.ok(), "{:?}", report.errors);
    assert_eq!(report.turns_checked, turn);
    assert!(report.ciphertexts_checked > 0);

    // Any tampering is caught.
    let mut forged = doc.clone();
    forged.turns[2].orders[0].recruit += 1;
    let bad = verify(&forged, Some(&pk), Some(&chain_turns), &chain_orders);
    assert!(!bad.ok());

    let mut forged = doc.clone();
    forged.turns[1].vrf.output_hex = "00".repeat(32);
    assert!(!verify(&forged, Some(&pk), None, &[]).ok());

    let wrong_key = [9u8; 32];
    let wrong_pk = ed25519_dalek::SigningKey::from_bytes(&wrong_key).verifying_key().to_bytes();
    assert!(!verify(&doc, Some(&wrong_pk), None, &[]).ok());
}

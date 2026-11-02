use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const VRF_SK: [u8; 32] = [5u8; 32];
const PK: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, deposit: u128, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("veil.near"))
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

fn contract() -> Veil {
    ctx("owner.near", 0, 1_000);
    let pk = SigningKey::from_bytes(&VRF_SK).verifying_key().to_bytes();
    Veil::new(acc("owner.near"), acc("outlayer.near"), "owner.near/veil-engine".into(), Some("ab".repeat(32)), hex::encode(pk), acc("usdc.near"))
}

/// The engine callback arrives as its own receipt, with fresh gas.
fn apply(c: &mut Veil, now_ms: u64, id: u64, op: &str, turn: u32, out: Option<Value>) {
    ctx("veil.near", 0, now_ms);
    c.apply_engine_output(id, op, turn, out);
}

fn vrf(seed: &str) -> Value {
    let alpha = format!("vrf:17:veil.near:{seed}");
    let sig = SigningKey::from_bytes(&VRF_SK).sign(alpha.as_bytes()).to_bytes();
    json!({ "output_hex": hex::encode(env::sha256(&sig)), "signature_hex": hex::encode(sig), "alpha": alpha })
}

fn engine_out(turn: u32, seed: &str, accounts: &[&str], game_over: bool, ranking: Option<Vec<u8>>) -> Value {
    let views: serde_json::Map<String, Value> = accounts.iter().map(|a| (a.to_string(), json!(format!("view-{a}-{turn}")))).collect();
    json!({
        "ok": true, "turn": turn, "game_pk": "22".repeat(32), "state_commit": format!("commit-{turn}"),
        "views": views, "vrf": vrf(seed),
        "public": { "turn": turn, "battles": [], "skirmishes": [], "eliminated": [], "tiles": [1, 1], "game_over": game_over, "ranking": ranking },
    })
}

#[test]
fn practice_lifecycle() {
    let mut c = contract();
    ctx("alice.near", 0, 1_000);
    let id = c.create_match(Mode::Practice, 3, 45_000, 2, Some(2));
    c.join_practice(id, PK.into());
    ctx("alice.near", 10u128.pow(23), 2_000);
    let _ = c.start(id);
    let m = c.get_match(id).unwrap();
    assert_eq!(m.status, Status::Starting);
    assert_eq!(m.seats.len(), 3);
    assert!(m.seats[1].ai && m.seats[2].ai);
    assert_eq!(m.engine_version, Some("ab".repeat(32)), "engine version pinned at creation");

    apply(&mut c, 2_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &["alice.near"], false, None)));
    let m = c.get_match(id).unwrap();
    assert_eq!(m.status, Status::Running);
    assert_eq!(m.turn, 1);
    assert_eq!(m.game_pk, Some("22".repeat(32)));
    assert_eq!(c.get_view(id, acc("alice.near")).unwrap().ciphertext, "view-alice.near-0");
    assert!(c.get_view(id, acc("warlord-1.veil")).is_none(), "AI views are not stored");

    // Orders in; everyone (the one human) has submitted, so the turn may resolve early.
    ctx("alice.near", 0, 3_000);
    c.submit_orders(id, 1, "Y2lwaGVy".into());
    assert_eq!(c.get_submitted(id), vec![acc("alice.near")]);
    ctx("relayer.near", 10u128.pow(23), 3_500);
    let _ = c.resolve_turn(id);
    assert_eq!(c.get_match(id).unwrap().status, Status::Resolving);
    apply(&mut c, 3_500, id, "resolve", 1, Some(engine_out(1, "turn-1", &["alice.near"], false, None)));
    let m = c.get_match(id).unwrap();
    assert_eq!((m.status, m.turn), (Status::Running, 2));
    assert!(c.get_submitted(id).is_empty(), "ciphertexts cleared after resolution");

    // Turn 2: nobody submits; resolves only after the deadline.
    ctx("relayer.near", 10u128.pow(23), m.deadline_ms);
    let _ = c.resolve_turn(id);
    assert_eq!(c.get_match(id).unwrap().seats[0].missed, 1);
    apply(&mut c, m.deadline_ms, id, "resolve", 2, Some(engine_out(2, "turn-2", &["alice.near"], true, Some(vec![0, 1, 2]))));
    let m = c.get_match(id).unwrap();
    assert_eq!(m.status, Status::Finished);
    assert_eq!(m.ranking, Some(vec![0, 1, 2]));
    assert_eq!(c.get_history(id, 0, 10).len(), 3);

    ctx("relayer.near", 1, m.deadline_ms);
    let _ = c.reveal(id);
    apply(&mut c, m.deadline_ms, id, "reveal", 0, Some(json!({ "ok": true, "hash": "abc", "key": format!("reveal:{id}"), "chunks": 1 })));
    let m = c.get_match(id).unwrap();
    assert_eq!(m.status, Status::Revealed);
    assert_eq!(m.reveal_hash.as_deref(), Some("abc"));
}

#[test]
fn bad_vrf_is_a_failed_run() {
    let mut c = contract();
    ctx("alice.near", 0, 1_000);
    let id = c.create_match(Mode::Practice, 2, 45_000, 1, None);
    c.join_practice(id, PK.into());
    ctx("alice.near", 1, 1_000);
    let _ = c.start(id);
    apply(&mut c, 1_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &["alice.near"], false, None)));
    ctx("relayer.near", 1, 50_000);
    let _ = c.resolve_turn(id);

    // Signed for the wrong turn → rejected; the turn reopens for 30 s.
    apply(&mut c, 50_000, id, "resolve", 1, Some(engine_out(1, "turn-2", &["alice.near"], false, None)));
    let m = c.get_match(id).unwrap();
    assert_eq!((m.status, m.turn, m.failures), (Status::Running, 1, 1));
    assert_eq!(m.deadline_ms, 50_000 + RETRY_DELAY_MS);

    // Forged signature → rejected.
    ctx("relayer.near", 1, m.deadline_ms);
    let _ = c.resolve_turn(id);
    let mut forged = engine_out(1, "turn-1", &["alice.near"], false, None);
    forged["vrf"]["alpha"] = json!("vrf:18:veil.near:turn-1");
    apply(&mut c, m.deadline_ms, id, "resolve", 1, Some(forged));
    assert_eq!(c.get_match(id).unwrap().failures, 2);

    // Engine error / null output → failed run, nothing stored.
    ctx("relayer.near", 1, m.deadline_ms + RETRY_DELAY_MS);
    let _ = c.resolve_turn(id);
    apply(&mut c, m.deadline_ms + RETRY_DELAY_MS, id, "resolve", 1, None);
    assert_eq!(c.get_match(id).unwrap().failures, 3);
    assert_eq!(c.get_history(id, 1, 5).len(), 0);
}

#[test]
fn stakes_buy_in_refund_and_payout() {
    let mut c = contract();
    ctx("host.near", 0, 1_000);
    let id = c.create_match(Mode::Stakes { buy_in: U128(1_000_000) }, 4, 45_000, 0, Some(1));
    let join = |c: &mut Veil, who: &str, amount: u128| {
        ctx("usdc.near", 0, 1_000);
        c.ft_on_transfer(acc(who), U128(amount), json!({ "join": id, "view_pk": PK }).to_string())
    };
    // Wrong token contract: refunded in full.
    ctx("fake-usdc.near", 0, 1_000);
    assert_eq!(c.ft_on_transfer(acc("a.near"), U128(1_000_000), json!({ "join": id, "view_pk": PK }).to_string()), U128(1_000_000));
    // Too little: refunded. Too much: excess refunded.
    assert_eq!(join(&mut c, "a.near", 999_999), U128(999_999));
    assert_eq!(join(&mut c, "a.near", 1_500_000), U128(500_000));
    assert_eq!(join(&mut c, "a.near", 1_000_000), U128(1_000_000), "already seated");
    for who in ["b.near", "c.near", "d.near"] {
        assert_eq!(join(&mut c, who, 1_000_000), U128(0));
    }
    assert_eq!(join(&mut c, "e.near", 1_000_000), U128(1_000_000), "full");
    assert_eq!(c.get_match(id).unwrap().pot, U128(4_000_000));

    // d leaves before start: refunded to their claimable balance.
    ctx("d.near", 0, 1_000);
    c.leave_lobby(id);
    assert_eq!(c.get_balance(acc("d.near")), U128(1_000_000));
    ctx("e.near", 0, 1_000);
    c.ft_on_transfer(acc("e.near"), U128(1_000_000), "{}".into());
    assert_eq!(join(&mut c, "e.near", 1_000_000), U128(0));

    ctx("host.near", 1, 2_000);
    let _ = c.start(id);
    let humans = ["a.near", "b.near", "c.near", "e.near"];
    apply(&mut c, 2_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &humans, false, None)));
    ctx("x.near", 1, 100_000);
    let _ = c.resolve_turn(id);
    // Ranking by seat index: e (3), c (2), a (0), b (1).
    apply(&mut c, 100_000, id, "resolve", 1, Some(engine_out(1, "turn-1", &humans, true, Some(vec![3, 2, 0, 1]))));
    let m = c.get_match(id).unwrap();
    assert_eq!(m.status, Status::Finished);
    // 4 paying seats: 70 / 30 of the pot after 5 % rake.
    assert_eq!(c.get_balance(acc("e.near")), U128(2_660_000));
    assert_eq!(c.get_balance(acc("c.near")), U128(1_140_000));
    assert_eq!(c.get_balance(acc("a.near")), U128(0));
    assert_eq!(c.get_config().rake, U128(200_000));
}

#[test]
#[should_panic(expected = "wrong turn")]
fn orders_for_the_wrong_turn_are_refused() {
    let mut c = contract();
    ctx("alice.near", 0, 1_000);
    let id = c.create_match(Mode::Practice, 2, 45_000, 1, None);
    c.join_practice(id, PK.into());
    ctx("alice.near", 1, 1_000);
    let _ = c.start(id);
    apply(&mut c, 1_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &["alice.near"], false, None)));
    ctx("alice.near", 0, 2_000);
    c.submit_orders(id, 2, "x".into());
}

#[test]
#[should_panic(expected = "ciphertext too large")]
fn oversize_orders_are_refused() {
    let mut c = contract();
    ctx("alice.near", 0, 1_000);
    c.submit_orders(1, 1, "x".repeat(MAX_ORDERS_B64 + 1));
}

#[test]
fn autopilot_after_three_misses_and_reclaim() {
    let mut c = contract();
    ctx("alice.near", 0, 1_000);
    let id = c.create_match(Mode::Practice, 2, 45_000, 1, Some(10));
    c.join_practice(id, PK.into());
    ctx("alice.near", 1, 1_000);
    let _ = c.start(id);
    apply(&mut c, 1_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &["alice.near"], false, None)));
    for t in 1..=3u32 {
        let m = c.get_match(id).unwrap();
        ctx("relayer.near", 1, m.deadline_ms);
        let _ = c.resolve_turn(id);
        apply(&mut c, m.deadline_ms, id, "resolve", t, Some(engine_out(t, &format!("turn-{t}"), &["alice.near"], false, None)));
    }
    assert!(c.get_match(id).unwrap().seats[0].autopilot);
    ctx("alice.near", 0, 1_000);
    c.claim_seat_back(id);
    assert!(!c.get_match(id).unwrap().seats[0].autopilot);
}

#[test]
fn warlords_have_wallets_that_only_matches_move() {
    let mut c = contract();
    // Anyone can stake a warlord; unknown names are refunded.
    ctx("usdc.near", 0, 1_000);
    assert_eq!(c.ft_on_transfer(acc("sponsor.near"), U128(3_000_000), json!({ "fund_warlord": "warlord-1.veil" }).to_string()), U128(0));
    assert_eq!(c.ft_on_transfer(acc("sponsor.near"), U128(5), json!({ "fund_warlord": "alice.near" }).to_string()), U128(5));
    assert_eq!(c.get_warlords()[0].1.treasury, U128(3_000_000));

    // A $1 stakes match: alice vs warlord-1 (funded) and warlord-2 (broke).
    ctx("host.near", 0, 1_000);
    let id = c.create_match(Mode::Stakes { buy_in: U128(1_000_000) }, 3, 45_000, 2, Some(1));
    ctx("usdc.near", 0, 1_000);
    assert_eq!(c.ft_on_transfer(acc("alice.near"), U128(1_000_000), json!({ "join": id, "view_pk": PK }).to_string()), U128(0));
    ctx("host.near", 1, 2_000);
    let _ = c.start(id);
    let m = c.get_match(id).unwrap();
    assert_eq!(m.seats[1].paid, U128(1_000_000), "warlord-1 paid its own buy-in");
    assert_eq!(m.seats[2].paid, U128(0), "warlord-2 could not afford it and plays for nothing");
    assert_eq!(m.pot, U128(2_000_000));
    assert_eq!(c.get_warlords()[0].1.treasury, U128(2_000_000));

    apply(&mut c, 2_000, id, "init", 0, Some(engine_out(0, &format!("init-{id}"), &["alice.near"], false, None)));
    ctx("x.near", 1, 100_000);
    let _ = c.resolve_turn(id);
    // Warlord-1 wins: the prize (pot minus 5 % rake) lands in its wallet, not with the owner.
    apply(&mut c, 100_000, id, "resolve", 1, Some(engine_out(1, "turn-1", &["alice.near"], true, Some(vec![1, 0, 2]))));
    let w = c.get_warlords();
    assert_eq!(w[0].1.treasury, U128(2_000_000 + 1_900_000));
    assert_eq!((w[0].1.played, w[0].1.won, w[0].1.earned), (1, 1, U128(1_900_000)));
    assert_eq!((w[1].1.played, w[1].1.won), (1, 0));
    assert_eq!(c.get_balance(acc("alice.near")), U128(0));
}

#[test]
fn a_failed_start_refunds_the_warlords() {
    let mut c = contract();
    ctx("usdc.near", 0, 1_000);
    c.ft_on_transfer(acc("sponsor.near"), U128(1_000_000), json!({ "fund_warlord": "warlord-1.veil" }).to_string());
    ctx("host.near", 0, 1_000);
    let id = c.create_match(Mode::Stakes { buy_in: U128(1_000_000) }, 2, 45_000, 1, None);
    ctx("usdc.near", 0, 1_000);
    c.ft_on_transfer(acc("alice.near"), U128(1_000_000), json!({ "join": id, "view_pk": PK }).to_string());
    ctx("host.near", 1, 2_000);
    let _ = c.start(id);
    apply(&mut c, 2_000, id, "init", 0, None);
    let m = c.get_match(id).unwrap();
    assert_eq!((m.status, m.pot), (Status::Lobby, U128(1_000_000)));
    assert_eq!(c.get_warlords()[0].1.treasury, U128(1_000_000));
}

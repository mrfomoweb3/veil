//! Property tests: determinism, conservation, one owner per tile, and the fog-leak suite.

use proptest::prelude::*;
use veil_rules::state::{MAX_SEATS, MIN_SEATS};
use veil_rules::view::VIEW_PLAINTEXT_LEN;
use veil_rules::vision::vision;
use veil_rules::*;

fn seed_from(n: u64, turn: u32) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[..8].copy_from_slice(&n.to_le_bytes());
    s[8..12].copy_from_slice(&turn.to_le_bytes());
    s
}

/// Bots play every seat from their own views. Returns the state after each turn.
fn play(seed: u64, seats: usize, turns: u32) -> Vec<GameState> {
    let mut st = generate(seed, seats, Config { max_turns: turns }, seed_from(seed, 0));
    let mut views: Vec<PlayerView> = (0..seats as u8).map(|p| build_view(&st, p, None, &[])).collect();
    let mut history = vec![st.clone()];
    while !st.game_over {
        let orders: Vec<Orders> = views.iter().map(|v| bot_orders(v, Personality::for_seat(v.me))).collect();
        let turn = st.turn;
        let out = resolve(&mut st, &orders, seed_from(seed, turn));
        views = (0..seats as u8).map(|p| build_view(&st, p, Some(&out), &[])).collect();
        history.push(st.clone());
    }
    history
}

#[test]
fn a_thousand_bot_matches_finish() {
    let mut fights = 0usize;
    for n in 0..1000u64 {
        let seats = MIN_SEATS + (n as usize % (MAX_SEATS - MIN_SEATS + 1));
        let h = play(n, seats, 20);
        let last = h.last().unwrap();
        assert!(last.game_over);
        assert!(last.turn <= 21);
        // Count turns in which some seat lost tiles: the bots must actually fight.
        fights += h
            .windows(2)
            .filter(|w| w[0].tile_counts().iter().zip(w[1].tile_counts()).any(|(a, b)| b < *a))
            .count();
    }
    assert!(fights > 3000, "bots barely fought: {fights} contested turns in 1000 matches");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn resolution_is_deterministic(seed in any::<u64>(), seats in MIN_SEATS..=MAX_SEATS, turns in 1u32..12) {
        let a = play(seed, seats, turns);
        let b = play(seed, seats, turns);
        prop_assert_eq!(a, b);
    }

    #[test]
    fn invariants_every_turn(seed in any::<u64>(), seats in MIN_SEATS..=MAX_SEATS) {
        let h = play(seed, seats, 20);
        for w in h.windows(2) {
            let (before, after) = (&w[0], &w[1]);
            for t in &after.tiles {
                // Neutral tiles hold nobody; void holds nothing.
                if t.owner.is_none() { prop_assert_eq!(t.troops, 0); prop_assert!(!t.fort); }
                if !t.terrain.passable() { prop_assert!(t.owner.is_none()); }
            }
            // Troops never appear from nowhere: at most +10 recruits per seat.
            let tb: u32 = before.troop_counts().iter().sum();
            let ta: u32 = after.troop_counts().iter().sum();
            prop_assert!(ta <= tb + 10 * seats as u32);
            // Dead players hold nothing.
            for (p, pl) in after.players.iter().enumerate() {
                if !pl.alive {
                    prop_assert!(after.tiles.iter().all(|t| t.owner != Some(p as u8)));
                    prop_assert_eq!(pl.aether, 0);
                }
            }
        }
    }

    /// The fog-leak suite. Changing anything a player cannot see must not change their view,
    /// and every view is exactly the same size.
    #[test]
    fn views_leak_nothing_outside_vision(seed in any::<u64>(), seats in MIN_SEATS..=MAX_SEATS, at in 0usize..20, noise in any::<u64>()) {
        let h = play(seed, seats, 20);
        let st = &h[at.min(h.len() - 1)];
        let board = st.board();
        for p in 0..seats as u8 {
            let base = build_view(st, p, None, &[]);
            let bytes = base.encode();
            prop_assert_eq!(bytes.len(), VIEW_PLAINTEXT_LEN);
            let decoded = PlayerView::decode(&bytes);
            prop_assert_eq!(decoded.as_ref(), Some(&base));

            let seen = vision(st, &board, p, None);
            for t in &base.tiles {
                prop_assert!(seen[t.index as usize], "view carries a tile outside vision");
            }

            // Scramble every hidden detail: troops, forts, other players' aether.
            let mut other = st.clone();
            let mut x = noise | 1;
            for (i, t) in other.tiles.iter_mut().enumerate() {
                if seen[i] { continue; }
                x ^= x << 13; x ^= x >> 7; x ^= x << 17;
                if t.owner.is_some() {
                    t.troops = 1 + (x % 50) as u32;
                    t.fort = x & 64 != 0;
                }
            }
            for (q, pl) in other.players.iter_mut().enumerate() {
                if q as u8 != p && pl.alive { pl.aether = (x % 97) as u32; }
            }
            prop_assert_eq!(build_view(&other, p, None, &[]).encode(), bytes);
        }
    }

    #[test]
    fn orders_roundtrip_padded(moves in 0usize..6, recruit in 0u32..20) {
        let o = Orders {
            moves: (0..moves).map(|k| Move { from: Hex(k as i32, -1), to: Hex(k as i32 + 1, -1), count: 3 }).collect(),
            scout: Some(vec![Hex(0, 0), Hex(1, 0), Hex(2, 0)]),
            fort: Some(Hex(-1, 2)),
            recruit,
            ..Default::default()
        };
        let b = o.to_padded().unwrap();
        prop_assert_eq!(b.len(), veil_rules::orders::ORDERS_PLAINTEXT_LEN);
        prop_assert_eq!(Orders::from_padded(&b), Some(o));
    }

    /// Garbage orders never panic and never move anything that isn't ours.
    #[test]
    fn hostile_orders_are_clamped(seed in any::<u64>(), qs in proptest::collection::vec((-6i32..6, -6i32..6, -6i32..6, -6i32..6, any::<u32>()), 0..12), recruit in any::<u32>()) {
        let mut st = generate(seed, 2, Config::default(), seed_from(seed, 0));
        let before = st.clone();
        let o = Orders {
            moves: qs.iter().map(|&(a, b, c, d, n)| Move { from: Hex(a, b), to: Hex(c, d), count: n }).collect(),
            scout: Some(qs.iter().map(|&(a, b, _, _, _)| Hex(a, b)).collect()),
            fort: qs.first().map(|&(a, b, _, _, _)| Hex(a, b)),
            recruit,
            ..Default::default()
        };
        let out = resolve(&mut st, &[o, Orders::default()], seed_from(seed, 1));
        prop_assert!(st.players[0].aether <= before.players[0].aether + st.income_of(0));
        // Seat 1 sent nothing; it can only have lost tiles through combat.
        let b = st.board();
        for (i, t) in before.tiles.iter().enumerate() {
            if t.owner == Some(1) && st.tiles[i].owner != Some(1) {
                prop_assert!(out.battles.contains(&b.hex(i)));
            }
        }
    }
}

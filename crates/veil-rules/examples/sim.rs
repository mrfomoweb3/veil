use veil_rules::*;
fn main() {
    for seats in 2..=6usize {
        let (mut elim, mut over_early, mut battles, mut tiles_max) = (0, 0, 0, 0u32);
        for n in 0..200u64 {
            let mut s = [0u8; 32];
            s[..8].copy_from_slice(&n.to_le_bytes());
            let mut st = generate(n, seats, Config::default(), s);
            let mut views: Vec<PlayerView> = (0..seats as u8).map(|p| build_view(&st, p, None, &[])).collect();
            while !st.game_over {
                let orders: Vec<Orders> = views.iter().map(|v| bot_orders(v, Personality::for_seat(v.me))).collect();
                s[8] = st.turn as u8;
                let out = resolve(&mut st, &orders, s);
                battles += out.battles.len() + out.skirmishes.len();
                elim += out.eliminated.len();
                views = (0..seats as u8).map(|p| build_view(&st, p, Some(&out), &[])).collect();
            }
            if st.turn < 21 { over_early += 1; }
            tiles_max += *st.tile_counts().iter().max().unwrap();
        }
        println!("seats {seats}: elims/match {:.2} early-end {} battles/match {:.1} leader tiles {:.1}", elim as f64 / 200.0, over_early, battles as f64 / 200.0, tiles_max as f64 / 200.0);
    }
}

//! Simultaneous turn resolution (spec §3.5) and combat (§3.6).
//!
//! The only entropy is `seed` (this turn's VRF output), expanded with ChaCha20. Combats are
//! resolved in a fixed order so a replay draws exactly the same rolls.

use crate::hex::Hex;
use crate::map::rng_from;
use crate::hex::Board;
use crate::orders::{sanitize, Feedback, Issue, Orders, Plan, TradeKind, MAX_TRADES, MAX_TRUCE_TURNS, ORDER_SCOUT, ORDER_TRADE};
use crate::state::{GameState, DOMINATION_PERMILLE, FORT_COST, FORT_MULT, MAX_PRICE, MIN_PRICE, SCALE, SCOUT_COST};
use crate::vision::vision;
use rand_chacha::ChaCha20Rng;
use rand_core::RngCore;
use serde::{Deserialize, Serialize};

/// What one player learns about a fight they were in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleReport {
    /// Where it happened. For an edge clash, the tile the player was leaving.
    pub tile: usize,
    /// For an edge clash, the tile the player was heading to.
    pub edge_to: Option<usize>,
    pub won: bool,
    pub mine_before: u32,
    pub mine_after: u32,
    pub others_before: u32,
    pub others_after: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnOutcome {
    /// Public: tiles where a tile combat happened.
    pub battles: Vec<Hex>,
    /// Public: edges where two moving stacks met.
    pub skirmishes: Vec<(Hex, Hex)>,
    /// Public: players eliminated this turn.
    pub eliminated: Vec<u8>,
    /// Private, per player.
    pub reports: Vec<Vec<BattleReport>>,
    pub feedback: Vec<Vec<Feedback>>,
    /// Private, per player: the tile their scout ended on, if it survived.
    pub scouts: Vec<Option<usize>>,
    /// Private, per player: islands revealed by intel bought from a warlord.
    #[serde(default)]
    pub intel: Vec<Vec<usize>>,
}

/// Step 0: trades with warlords. Paid in aether before anything else, so the rest of the
/// turn is clamped against what is left. Intel is only sold if the warlord can actually see
/// the island; nothing is charged otherwise.
fn trade(state: &mut GameState, board: &Board, orders: &[Orders], out: &mut TurnOutcome) {
    let n = state.players.len();
    let turn = state.turn;
    let sight: Vec<Vec<bool>> = (0..n as u8).map(|w| vision(state, board, w, None)).collect();
    for (p, o) in orders.iter().enumerate() {
        if !state.players[p].alive {
            continue;
        }
        for (k, t) in o.trades.iter().enumerate() {
            let order = ORDER_TRADE + k.min(40) as u8;
            let fb = |issue| Feedback { issue, order };
            let w = t.with as usize;
            let ok_partner = k < MAX_TRADES && w < n && w != p && state.players[w].warlord && state.players[w].alive;
            if !ok_partner {
                out.feedback[p].push(fb(Issue::TradeRefused));
                continue;
            }
            let prices = state.players[w].prices;
            match &t.kind {
                TradeKind::Intel { at } => {
                    let Some(i) = board.index(*at) else {
                        out.feedback[p].push(fb(Issue::TradeRefused));
                        continue;
                    };
                    if !sight[w][i] {
                        out.feedback[p].push(fb(Issue::TradeUnknown));
                        continue;
                    }
                    if state.players[p].aether < prices.intel {
                        out.feedback[p].push(fb(Issue::NotEnoughAether));
                        continue;
                    }
                    state.players[p].aether -= prices.intel;
                    state.players[w].aether += prices.intel;
                    let around = at.neighbors().into_iter().filter_map(|h| board.index(h)).filter(|&j| sight[w][j]);
                    out.intel[p].push(i);
                    out.intel[p].extend(around);
                    out.feedback[p].push(fb(Issue::IntelBought));
                }
                TradeKind::Truce { turns } => {
                    let turns = (*turns).clamp(1, MAX_TRUCE_TURNS);
                    let cost = prices.truce * turns;
                    if state.players[p].aether < cost {
                        out.feedback[p].push(fb(Issue::NotEnoughAether));
                        continue;
                    }
                    state.players[p].aether -= cost;
                    state.players[w].aether += cost;
                    let until = turn + turns - 1;
                    let truces = &mut state.players[w].truces;
                    match truces.iter_mut().find(|(b, _)| *b as usize == p) {
                        Some(e) => e.1 = e.1.max(until),
                        None => truces.push((p as u8, until)),
                    }
                    out.feedback[p].push(fb(Issue::TruceBought));
                }
            }
        }
    }
    // Warlords set what they will charge from next turn.
    for (w, o) in orders.iter().enumerate() {
        if let (true, Some(pr)) = (state.players[w].warlord, o.prices) {
            state.players[w].prices.intel = pr.intel.clamp(MIN_PRICE, MAX_PRICE);
            state.players[w].prices.truce = pr.truce.clamp(MIN_PRICE, MAX_PRICE);
        }
    }
}

/// Truces bind the warlord: its moves into a buyer's islands are dropped. A buyer that
/// attacks the warlord breaks its own truce, this very turn.
fn enforce_truces(state: &mut GameState, plans: &mut [Plan], out: &mut TurnOutcome) {
    let turn = state.turn;
    for w in 0..state.players.len() {
        if !state.players[w].warlord {
            continue;
        }
        let truces = state.players[w].truces.clone();
        let mut kept = Vec::new();
        for (b, until) in truces {
            if until < turn {
                continue;
            }
            let attacks = plans[b as usize].moves.iter().any(|&(_, t, _)| state.tiles[t].owner == Some(w as u8));
            if attacks {
                out.feedback[b as usize].push(Feedback { issue: Issue::TruceBroken, order: ORDER_TRADE });
                continue;
            }
            plans[w].moves.retain(|&(_, t, _)| state.tiles[t].owner != Some(b));
            kept.push((b, until));
        }
        state.players[w].truces = kept;
    }
}

#[derive(Clone, Copy, Debug)]
struct Side {
    owner: u8,
    troops: u32,
    mult: u64,
    defender: bool,
}

impl Side {
    fn eff(&self) -> u64 {
        self.troops as u64 * self.mult
    }
}

/// Roll in [850, 1150] (×1000).
fn roll(rng: &mut ChaCha20Rng) -> u64 {
    850 + rng.next_u64() % 301
}

/// One duel. Returns (winner, loser) with the winner's troops reduced.
fn duel(a: Side, b: Side, rng: &mut ChaCha20Rng) -> (Side, Side) {
    let sa = a.eff() as u128 * roll(rng) as u128;
    let sb = b.eff() as u128 * roll(rng) as u128;
    let a_wins = match sa.cmp(&sb) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => {
            if a.defender != b.defender {
                a.defender
            } else if a.troops != b.troops {
                a.troops > b.troops
            } else {
                a.owner < b.owner
            }
        }
    };
    let (mut w, l) = if a_wins { (a, b) } else { (b, a) };
    let loss = (l.eff()).div_ceil(w.mult) as u32;
    let loss = loss.max(1).min(w.troops.saturating_sub(1));
    w.troops -= loss;
    (w, l)
}

/// Free-for-all: strongest effective pair fights first, the winner fights on.
fn melee(mut sides: Vec<Side>, rng: &mut ChaCha20Rng) -> Side {
    while sides.len() > 1 {
        sides.sort_by(|x, y| {
            y.eff()
                .cmp(&x.eff())
                .then(y.defender.cmp(&x.defender))
                .then(x.owner.cmp(&y.owner))
        });
        let b = sides.remove(1);
        let a = sides.remove(0);
        let (w, _) = duel(a, b, rng);
        sides.insert(0, w);
    }
    sides[0]
}

struct Flight {
    owner: u8,
    from: usize,
    to: usize,
    count: u32,
}

/// Resolve one turn in place. `orders[p]` are seat `p`'s orders (empty when missed).
pub fn resolve(state: &mut GameState, orders: &[Orders], seed: [u8; 32]) -> TurnOutcome {
    assert_eq!(orders.len(), state.players.len(), "one order set per seat");
    let board = state.board();
    let n = state.players.len();
    let mut rng = rng_from(seed);
    let mut out = TurnOutcome {
        reports: vec![Vec::new(); n],
        feedback: vec![Vec::new(); n],
        scouts: vec![None; n],
        intel: vec![Vec::new(); n],
        ..Default::default()
    };

    // 0. Trades with warlords.
    trade(state, &board, orders, &mut out);

    // Plans are clamped against the state as it was when the turn opened (after trades).
    let mut plans: Vec<Plan> = (0..n)
        .map(|p| {
            let (plan, fb) = sanitize(state, &board, p as u8, &orders[p]);
            out.feedback[p].extend(fb);
            plan
        })
        .collect();
    enforce_truces(state, &mut plans, &mut out);

    // 1. Recruit, then fort; scouts pay now too.
    for (p, plan) in plans.iter().enumerate() {
        if !state.players[p].alive {
            continue;
        }
        let cap = board.index(state.players[p].capital).unwrap();
        let mut spent = plan.recruit;
        state.tiles[cap].troops += plan.recruit;
        if let Some(f) = plan.fort {
            state.tiles[f].fort = true;
            spent += FORT_COST;
        }
        if plan.scout.is_some() {
            spent += SCOUT_COST;
        }
        state.players[p].aether -= spent;
    }

    // 2. Lift moving troops off their tiles.
    let mut flights: Vec<Flight> = Vec::new();
    for (p, plan) in plans.iter().enumerate() {
        for &(from, to, count) in &plan.moves {
            state.tiles[from].troops -= count;
            flights.push(Flight { owner: p as u8, from, to, count });
        }
    }

    // 3. Edge clashes: opposing stacks crossing the same edge fight first, no terrain.
    for i in 0..flights.len() {
        for j in (i + 1)..flights.len() {
            let (a, b) = (&flights[i], &flights[j]);
            if a.owner == b.owner || a.from != b.to || a.to != b.from || a.count == 0 || b.count == 0 {
                continue;
            }
            let sa = Side { owner: a.owner, troops: a.count, mult: SCALE, defender: false };
            let sb = Side { owner: b.owner, troops: b.count, mult: SCALE, defender: false };
            let (w, _) = duel(sa, sb, &mut rng);
            let (ai, bi) = (i, j);
            let (before_a, before_b) = (flights[ai].count, flights[bi].count);
            if w.owner == flights[ai].owner {
                flights[ai].count = w.troops;
                flights[bi].count = 0;
            } else {
                flights[bi].count = w.troops;
                flights[ai].count = 0;
            }
            for (me, other) in [(ai, bi), (bi, ai)] {
                let (mb, ob) = if me == ai { (before_a, before_b) } else { (before_b, before_a) };
                out.reports[flights[me].owner as usize].push(BattleReport {
                    tile: flights[me].from,
                    edge_to: Some(flights[me].to),
                    won: flights[me].count > 0,
                    mine_before: mb,
                    mine_after: flights[me].count,
                    others_before: ob,
                    others_after: flights[other].count,
                });
            }
            let (x, y) = (board.hex(flights[ai].from), board.hex(flights[ai].to));
            out.skirmishes.push(if x < y { (x, y) } else { (y, x) });
        }
    }

    // 4–6. Arrivals, tile combat, captures — tile by tile in index order.
    for t in 0..board.len() {
        let arriving: Vec<&Flight> = flights.iter().filter(|f| f.to == t && f.count > 0).collect();
        if arriving.is_empty() {
            continue;
        }
        let tile = &state.tiles[t];
        let def_mult = tile.terrain.defense() * if tile.fort { FORT_MULT } else { SCALE } / SCALE;
        let mut sides: Vec<Side> = Vec::new();
        if let Some(o) = tile.owner {
            let own_arrivals: u32 = arriving.iter().filter(|f| f.owner == o).map(|f| f.count).sum();
            let troops = tile.troops + own_arrivals;
            if troops > 0 {
                sides.push(Side { owner: o, troops, mult: def_mult, defender: true });
            }
        }
        for f in &arriving {
            if Some(f.owner) == tile.owner {
                continue;
            }
            if let Some(s) = sides.iter_mut().find(|s| s.owner == f.owner) {
                s.troops += f.count;
            } else {
                sides.push(Side { owner: f.owner, troops: f.count, mult: SCALE, defender: false });
            }
        }
        sides.sort_by_key(|s| s.owner);
        let winner = if sides.len() > 1 {
            let before: Vec<Side> = sides.clone();
            let w = melee(sides, &mut rng);
            let total: u32 = before.iter().map(|s| s.troops).sum();
            for s in &before {
                let mine_after = if s.owner == w.owner { w.troops } else { 0 };
                out.reports[s.owner as usize].push(BattleReport {
                    tile: t,
                    edge_to: None,
                    won: s.owner == w.owner,
                    mine_before: s.troops,
                    mine_after,
                    others_before: total - s.troops,
                    others_after: if s.owner == w.owner { 0 } else { w.troops },
                });
            }
            out.battles.push(board.hex(t));
            w
        } else {
            sides[0]
        };
        let tile = &mut state.tiles[t];
        if tile.owner != Some(winner.owner) {
            tile.fort = false;
        }
        tile.owner = Some(winner.owner);
        tile.troops = winner.troops;
    }

    // 6b. A captured capital eliminates its player; their holdings dissolve.
    let resolved_turn = state.turn;
    for p in 0..n {
        if !state.players[p].alive {
            continue;
        }
        let cap = board.index(state.players[p].capital).unwrap();
        if state.tiles[cap].owner != Some(p as u8) {
            state.players[p].alive = false;
            state.players[p].aether = 0;
            state.players[p].eliminated_turn = Some(resolved_turn);
            for tile in state.tiles.iter_mut() {
                if tile.owner == Some(p as u8) {
                    tile.owner = None;
                    tile.troops = 0;
                    tile.fort = false;
                }
            }
            out.eliminated.push(p as u8);
        }
    }

    // 7. Scouts: they die if they end on a tile an enemy holds with troops.
    for (p, plan) in plans.iter().enumerate() {
        if !state.players[p].alive {
            continue;
        }
        if let Some(path) = &plan.scout {
            let end = *path.last().unwrap();
            let t = &state.tiles[end];
            if t.owner.is_some_and(|o| o as usize != p) && t.troops > 0 {
                out.feedback[p].push(Feedback { issue: Issue::ScoutLost, order: ORDER_SCOUT });
            } else {
                out.scouts[p] = Some(end);
            }
        }
    }

    // 8. Income.
    for p in 0..n {
        if state.players[p].alive {
            let inc = state.income_of(p as u8);
            state.players[p].aether += inc;
        }
    }

    // 9. End of match?
    state.turn += 1;
    let non_void = state.non_void_count() as u64;
    let dominated = state
        .tile_counts()
        .iter()
        .enumerate()
        .any(|(p, &c)| state.players[p].alive && c as u64 * SCALE >= DOMINATION_PERMILLE * non_void);
    if resolved_turn >= state.config.max_turns || dominated || state.alive_count() <= 1 {
        state.game_over = true;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hex::Hex;
    use crate::orders::Move;
    use crate::state::{Config, Player, Terrain, Tile};

    /// A tiny 2-player board: radius 4, all plains, capitals far apart.
    fn flat() -> GameState {
        let board = crate::hex::Board::new(4);
        let tiles = vec![Tile { terrain: Terrain::Plains, owner: None, troops: 0, fort: false }; board.len()];
        let mut s = GameState {
            match_id: 1,
            turn: 1,
            radius: 4,
            config: Config::default(),
            tiles,
            players: vec![
                Player { aether: 0, alive: true, capital: Hex(-3, 0), eliminated_turn: None, ..Default::default() },
                Player { aether: 0, alive: true, capital: Hex(3, 0), eliminated_turn: None, ..Default::default() },
            ],
            game_over: false,
        };
        for (p, c) in [Hex(-3, 0), Hex(3, 0)].iter().enumerate() {
            let i = board.index(*c).unwrap();
            s.tiles[i] = Tile { terrain: Terrain::Capital, owner: Some(p as u8), troops: 6, fort: false };
        }
        s
    }

    fn put(s: &mut GameState, h: Hex, owner: u8, troops: u32) {
        let i = s.board().index(h).unwrap();
        s.tiles[i].owner = Some(owner);
        s.tiles[i].troops = troops;
    }

    #[test]
    fn move_into_empty_captures() {
        let mut s = flat();
        let o = Orders { moves: vec![Move { from: Hex(-3, 0), to: Hex(-2, 0), count: 4 }], ..Default::default() };
        let out = resolve(&mut s, &[o, Orders::default()], [0; 32]);
        let b = s.board();
        assert_eq!(s.tile(&b, Hex(-2, 0)).unwrap().owner, Some(0));
        assert_eq!(s.tile(&b, Hex(-2, 0)).unwrap().troops, 4);
        assert_eq!(s.tile(&b, Hex(-3, 0)).unwrap().troops, 2);
        assert!(out.battles.is_empty());
    }

    #[test]
    fn overwhelming_attack_wins_and_defender_holds_ties() {
        let mut s = flat();
        put(&mut s, Hex(0, 0), 0, 30);
        put(&mut s, Hex(1, 0), 1, 2);
        let o = Orders { moves: vec![Move { from: Hex(0, 0), to: Hex(1, 0), count: 29 }], ..Default::default() };
        let out = resolve(&mut s, &[o, Orders::default()], [3; 32]);
        let b = s.board();
        let t = s.tile(&b, Hex(1, 0)).unwrap();
        assert_eq!(t.owner, Some(0));
        assert!(t.troops >= 26 && t.troops <= 28, "lost about the defender's strength, got {}", t.troops);
        assert_eq!(out.battles, vec![Hex(1, 0)]);
        assert_eq!(out.reports[0].len(), 1);
        assert_eq!(out.reports[1].len(), 1);
        assert!(!out.reports[1][0].won);
    }

    #[test]
    fn edge_clash_happens_before_arrival() {
        let mut s = flat();
        put(&mut s, Hex(0, 0), 0, 10);
        put(&mut s, Hex(1, 0), 1, 10);
        let a = Orders { moves: vec![Move { from: Hex(0, 0), to: Hex(1, 0), count: 10 }], ..Default::default() };
        let b = Orders { moves: vec![Move { from: Hex(1, 0), to: Hex(0, 0), count: 10 }], ..Default::default() };
        let out = resolve(&mut s, &[a, b], [5; 32]);
        assert_eq!(out.skirmishes.len(), 1);
        assert_eq!(out.reports[0][0].edge_to.is_some(), true);
    }

    #[test]
    fn capital_capture_eliminates() {
        let mut s = flat();
        put(&mut s, Hex(2, 0), 0, 60);
        put(&mut s, Hex(-2, 0), 1, 3);
        let o = Orders { moves: vec![Move { from: Hex(2, 0), to: Hex(3, 0), count: 59 }], ..Default::default() };
        let out = resolve(&mut s, &[o, Orders::default()], [1; 32]);
        assert_eq!(out.eliminated, vec![1]);
        assert!(!s.players[1].alive);
        let b = s.board();
        assert_eq!(s.tile(&b, Hex(-2, 0)).unwrap().owner, None, "loser's other tiles go neutral");
        assert!(s.game_over);
    }

    #[test]
    fn recruit_fort_and_income() {
        let mut s = flat();
        s.players[0].aether = 12;
        let o = Orders { recruit: 5, fort: Some(Hex(-3, 0)), ..Default::default() };
        resolve(&mut s, &[o, Orders::default()], [0; 32]);
        let b = s.board();
        let cap = s.tile(&b, Hex(-3, 0)).unwrap();
        assert_eq!(cap.troops, 11);
        assert!(cap.fort);
        assert_eq!(s.players[0].aether, 12 - 5 - 6 + 3);
    }

    fn with_warlord() -> GameState {
        let mut s = flat();
        s.players[1].warlord = true;
        s.players[0].aether = 30;
        s
    }

    #[test]
    fn intel_is_sold_only_for_what_the_warlord_sees() {
        use crate::orders::{Trade, TradeKind};
        let mut s = with_warlord();
        let b = s.board();
        let price = s.players[1].prices.intel;
        // (2, 0) is next to the warlord's capital: it can see it. (-1, 0) it cannot.
        let o = Orders {
            trades: vec![
                Trade { with: 1, kind: TradeKind::Intel { at: Hex(2, 0) } },
                Trade { with: 1, kind: TradeKind::Intel { at: Hex(-1, 0) } },
            ],
            ..Default::default()
        };
        let out = resolve(&mut s, &[o, Orders::default()], [0; 32]);
        assert!(out.intel[0].contains(&b.index(Hex(2, 0)).unwrap()));
        assert!(!out.intel[0].contains(&b.index(Hex(-1, 0)).unwrap()));
        assert!(out.feedback[0].iter().any(|f| f.issue == Issue::IntelBought));
        assert!(out.feedback[0].iter().any(|f| f.issue == Issue::TradeUnknown));
        // Paid once (plus income), warlord earned it.
        assert_eq!(s.players[0].aether, 30 - price + s.income_of(0));
        assert_eq!(s.players[1].aether, price + s.income_of(1));
        // The buyer's view now shows that island.
        let v = crate::view::build_view(&s, 0, Some(&out), &[]);
        assert!(v.tiles.iter().any(|t| t.index as usize == b.index(Hex(2, 0)).unwrap()));
        assert!(v.seats[1].warlord);
    }

    #[test]
    fn trades_with_humans_or_yourself_are_refused() {
        use crate::orders::{Trade, TradeKind};
        let mut s = flat();
        s.players[0].aether = 30;
        let o = Orders { trades: vec![Trade { with: 1, kind: TradeKind::Truce { turns: 2 } }], ..Default::default() };
        let out = resolve(&mut s, &[o, Orders::default()], [0; 32]);
        assert!(out.feedback[0].iter().any(|f| f.issue == Issue::TradeRefused));
        assert_eq!(s.players[0].aether, 30 + s.income_of(0));
    }

    #[test]
    fn a_truce_stops_the_warlord_and_attacking_breaks_it() {
        use crate::orders::{Trade, TradeKind};
        let mut s = with_warlord();
        put(&mut s, Hex(0, 0), 0, 3);
        put(&mut s, Hex(1, 0), 1, 20);
        let buy = Orders { trades: vec![Trade { with: 1, kind: TradeKind::Truce { turns: 3 } }], ..Default::default() };
        let attack = Orders { moves: vec![Move { from: Hex(1, 0), to: Hex(0, 0), count: 19 }], ..Default::default() };
        resolve(&mut s, &[buy, attack.clone()], [2; 32]);
        let b = s.board();
        assert_eq!(s.tile(&b, Hex(0, 0)).unwrap().owner, Some(0), "the warlord's attack was called off");
        assert_eq!(s.players[1].truces, vec![(0, 3)]);

        // Turn 2: the buyer attacks the warlord, so the truce breaks and the warlord strikes back.
        let betray = Orders { moves: vec![Move { from: Hex(0, 0), to: Hex(1, 0), count: 1 }], ..Default::default() };
        let out = resolve(&mut s, &[betray, attack], [4; 32]);
        assert!(out.feedback[0].iter().any(|f| f.issue == Issue::TruceBroken));
        assert!(s.players[1].truces.is_empty());
        assert_eq!(s.tile(&b, Hex(0, 0)).unwrap().owner, Some(1));
    }

    #[test]
    fn only_warlords_set_prices() {
        use crate::state::Prices;
        let mut s = with_warlord();
        let p = Some(Prices { intel: 9, truce: 500 });
        resolve(&mut s, &[Orders { prices: p, ..Default::default() }, Orders { prices: p, ..Default::default() }], [0; 32]);
        assert_eq!(s.players[0].prices, Prices::default());
        assert_eq!(s.players[1].prices, Prices { intel: 9, truce: crate::state::MAX_PRICE });
    }

}

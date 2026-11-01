//! Map generation from a VRF seed. Same seed, same map, everywhere.

use crate::hex::{Board, Hex};
use crate::state::{Config, GameState, Player, Terrain, Tile, MAX_SEATS, MIN_SEATS, START_AETHER, START_TROOPS};
use rand_chacha::ChaCha20Rng;
use rand_core::{RngCore, SeedableRng};
use std::collections::VecDeque;

pub const MIN_CAPITAL_DISTANCE: u32 = 4;
const MAX_ATTEMPTS: u32 = 400;

pub fn radius_for(seats: usize) -> u32 {
    if seats <= 4 {
        4
    } else {
        5
    }
}

pub fn rng_from(seed: [u8; 32]) -> ChaCha20Rng {
    ChaCha20Rng::from_seed(seed)
}

/// Uniform-enough value in `0..n` (n is tiny, modulo bias is irrelevant here but kept explicit).
pub(crate) fn below(rng: &mut ChaCha20Rng, n: u32) -> u32 {
    (rng.next_u64() % n as u64) as u32
}

/// BFS distances over passable tiles from `start`; `u32::MAX` where unreachable.
pub fn bfs(board: &Board, terrain: &[Terrain], start: Hex) -> Vec<u32> {
    let mut dist = vec![u32::MAX; board.len()];
    let Some(s) = board.index(start) else { return dist };
    if !terrain[s].passable() {
        return dist;
    }
    dist[s] = 0;
    let mut q = VecDeque::from([start]);
    while let Some(h) = q.pop_front() {
        let d = dist[board.index(h).unwrap()];
        for n in h.neighbors() {
            if let Some(i) = board.index(n) {
                if terrain[i].passable() && dist[i] == u32::MAX {
                    dist[i] = d + 1;
                    q.push_back(n);
                }
            }
        }
    }
    dist
}

pub fn capital_positions(radius: u32, seats: usize, offset: usize) -> Vec<Hex> {
    let ring = Board::ring(radius - 1);
    let l = ring.len();
    (0..seats).map(|i| ring[(offset + i * l / seats) % l]).collect()
}

/// Every seat's capital, worked out from one's own seat and capital. Capital placement is
/// an open rule (evenly spaced on ring R-1), so this is public knowledge, not a leak: the fog
/// hides armies, not geography.
pub fn infer_capitals(radius: u32, seats: usize, me: u8, my_capital: Hex) -> Vec<Hex> {
    let ring = Board::ring(radius - 1);
    let l = ring.len();
    let Some(pos) = ring.iter().position(|h| *h == my_capital) else { return vec![] };
    let offset = (pos + l - (me as usize * l / seats) % l) % l;
    capital_positions(radius, seats, offset)
}

/// Generate the opening state. Panics only on an invalid seat count.
pub fn generate(match_id: u64, seats: usize, config: Config, seed: [u8; 32]) -> GameState {
    assert!((MIN_SEATS..=MAX_SEATS).contains(&seats), "seats out of range");
    let radius = radius_for(seats);
    let board = Board::new(radius);
    let mut rng = rng_from(seed);
    let mut fallback = None;
    for attempt in 0..MAX_ATTEMPTS {
        let (terrain, capitals, balanced) = attempt_map(&board, seats, &mut rng);
        if let Some(t) = terrain {
            if balanced {
                return build(match_id, radius, config, t, capitals);
            }
            if fallback.is_none() || attempt == MAX_ATTEMPTS - 1 {
                fallback = Some((t, capitals));
            }
        }
    }
    let (t, c) = fallback.expect("a connected map is always found");
    build(match_id, radius, config, t, c)
}

fn build(match_id: u64, radius: u32, config: Config, terrain: Vec<Terrain>, capitals: Vec<Hex>) -> GameState {
    let board = Board::new(radius);
    let mut tiles: Vec<Tile> = terrain
        .into_iter()
        .map(|terrain| Tile { terrain, owner: None, troops: 0, fort: false })
        .collect();
    let mut players = Vec::new();
    for (p, c) in capitals.iter().enumerate() {
        let t = &mut tiles[board.index(*c).unwrap()];
        t.owner = Some(p as u8);
        t.troops = START_TROOPS;
        players.push(Player { aether: START_AETHER, alive: true, capital: *c, eliminated_turn: None });
    }
    GameState { match_id, turn: 1, radius, config, tiles, players, game_over: false }
}

/// One attempt. Returns (terrain if connected & valid, capitals, shrine balance ok).
fn attempt_map(board: &Board, seats: usize, rng: &mut ChaCha20Rng) -> (Option<Vec<Terrain>>, Vec<Hex>, bool) {
    let ring_len = 6 * (board.radius - 1) as usize;
    let offset = below(rng, ring_len as u32) as usize;
    let capitals = capital_positions(board.radius, seats, offset);

    let mut terrain = vec![Terrain::Plains; board.len()];
    for (i, h) in board.hexes().iter().enumerate() {
        let near_capital = capitals.iter().any(|c| c.distance(*h) <= 1);
        let roll = below(rng, 100);
        terrain[i] = if near_capital {
            // Capitals sit on solid ground: neighbours are never void.
            if roll < 20 {
                Terrain::Forest
            } else if roll < 35 {
                Terrain::Highland
            } else {
                Terrain::Plains
            }
        } else if roll < 11 {
            Terrain::Void
        } else if roll < 31 {
            Terrain::Forest
        } else if roll < 45 {
            Terrain::Highland
        } else {
            Terrain::Plains
        };
    }
    for c in &capitals {
        terrain[board.index(*c).unwrap()] = Terrain::Capital;
        // At least two plains neighbours.
        let ns: Vec<usize> = c.neighbors().iter().filter_map(|n| board.index(*n)).collect();
        let mut plains = ns.iter().filter(|&&i| terrain[i] == Terrain::Plains).count();
        for &i in &ns {
            if plains >= 2 {
                break;
            }
            if terrain[i] != Terrain::Plains {
                terrain[i] = Terrain::Plains;
                plains += 1;
            }
        }
    }

    // Shrines: one per seat plus one, away from capitals.
    let shrine_count = seats + 1;
    let candidates: Vec<usize> = (0..board.len())
        .filter(|&i| {
            let h = board.hex(i);
            terrain[i] != Terrain::Capital && capitals.iter().all(|c| c.distance(h) >= 2)
        })
        .collect();
    let mut chosen = Vec::new();
    let mut pool = candidates.clone();
    while chosen.len() < shrine_count && !pool.is_empty() {
        let k = below(rng, pool.len() as u32) as usize;
        chosen.push(pool.swap_remove(k));
    }
    for &i in &chosen {
        terrain[i] = Terrain::Shrine;
    }

    // Validity: capitals far enough apart, every passable tile connected.
    for (a, ca) in capitals.iter().enumerate() {
        for cb in capitals.iter().skip(a + 1) {
            if ca.distance(*cb) < MIN_CAPITAL_DISTANCE {
                return (None, capitals, false);
            }
        }
    }
    let dist0 = bfs(board, &terrain, capitals[0]);
    if (0..board.len()).any(|i| terrain[i].passable() && dist0[i] == u32::MAX) {
        return (None, capitals, false);
    }

    // Balance: the k-th nearest shrine (k = 1, 2) is within ±1 across capitals.
    let mut nearest: Vec<Vec<u32>> = Vec::new();
    for c in &capitals {
        let d = bfs(board, &terrain, *c);
        let mut ds: Vec<u32> = chosen.iter().map(|&i| d[i]).collect();
        ds.sort_unstable();
        nearest.push(ds);
    }
    let balanced = (0..2).all(|k| {
        let vals: Vec<u32> = nearest.iter().map(|v| v[k]).collect();
        vals.iter().max().unwrap() - vals.iter().min().unwrap() <= 1
    });
    (Some(terrain), capitals, balanced)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(n: u64) -> [u8; 32] {
        let mut s = [0u8; 32];
        s[..8].copy_from_slice(&n.to_le_bytes());
        s
    }

    #[test]
    fn invariants_hold_for_many_seeds() {
        let mut unbalanced = 0;
        for seats in MIN_SEATS..=MAX_SEATS {
            for n in 0..60u64 {
                let st = generate(7, seats, Config::default(), seed(n * 31 + seats as u64));
                let board = st.board();
                let terrain: Vec<Terrain> = st.tiles.iter().map(|t| t.terrain).collect();
                assert_eq!(st.players.len(), seats);
                for (a, pa) in st.players.iter().enumerate() {
                    for pb in st.players.iter().skip(a + 1) {
                        assert!(pa.capital.distance(pb.capital) >= MIN_CAPITAL_DISTANCE);
                    }
                    let plains = pa
                        .capital
                        .neighbors()
                        .iter()
                        .filter_map(|h| board.index(*h))
                        .filter(|&i| terrain[i] == Terrain::Plains)
                        .count();
                    assert!(plains >= 2);
                }
                let d = bfs(&board, &terrain, st.players[0].capital);
                assert!((0..board.len()).all(|i| !terrain[i].passable() || d[i] != u32::MAX));
                let shrines = terrain.iter().filter(|t| **t == Terrain::Shrine).count();
                assert_eq!(shrines, seats + 1);
                let mut nearest = Vec::new();
                for p in &st.players {
                    let d = bfs(&board, &terrain, p.capital);
                    let mut ds: Vec<u32> =
                        (0..board.len()).filter(|&i| terrain[i] == Terrain::Shrine).map(|i| d[i]).collect();
                    ds.sort_unstable();
                    nearest.push(ds);
                }
                let ok = (0..2).all(|k| {
                    let v: Vec<u32> = nearest.iter().map(|x| x[k]).collect();
                    v.iter().max().unwrap() - v.iter().min().unwrap() <= 1
                });
                if !ok {
                    unbalanced += 1;
                }
            }
        }
        assert_eq!(unbalanced, 0, "every generated map should pass the shrine balance check");
    }

    #[test]
    fn capitals_can_be_inferred() {
        for seats in MIN_SEATS..=MAX_SEATS {
            let st = generate(3, seats, Config::default(), seed(seats as u64));
            let all: Vec<Hex> = st.players.iter().map(|p| p.capital).collect();
            for (p, pl) in st.players.iter().enumerate() {
                assert_eq!(infer_capitals(st.radius, seats, p as u8, pl.capital), all);
            }
        }
    }

    #[test]
    fn deterministic() {
        let a = generate(1, 4, Config::default(), seed(9));
        let b = generate(1, 4, Config::default(), seed(9));
        assert_eq!(a, b);
        let c = generate(1, 4, Config::default(), seed(10));
        assert_ne!(a.tiles, c.tiles);
    }
}

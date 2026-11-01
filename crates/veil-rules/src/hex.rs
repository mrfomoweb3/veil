//! Axial hex coordinates and the fixed tile ordering of a radius-R board.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Hex(pub i32, pub i32);

pub const DIRS: [Hex; 6] = [Hex(1, 0), Hex(1, -1), Hex(0, -1), Hex(-1, 0), Hex(-1, 1), Hex(0, 1)];

impl Hex {
    pub fn q(self) -> i32 {
        self.0
    }
    pub fn r(self) -> i32 {
        self.1
    }
    pub fn s(self) -> i32 {
        -self.0 - self.1
    }
    pub fn add(self, o: Hex) -> Hex {
        Hex(self.0 + o.0, self.1 + o.1)
    }
    pub fn scale(self, k: i32) -> Hex {
        Hex(self.0 * k, self.1 * k)
    }
    pub fn distance(self, o: Hex) -> u32 {
        let dq = (self.0 - o.0).abs();
        let dr = (self.1 - o.1).abs();
        let ds = (self.s() - o.s()).abs();
        ((dq + dr + ds) / 2) as u32
    }
    pub fn length(self) -> u32 {
        self.distance(Hex(0, 0))
    }
    pub fn neighbors(self) -> [Hex; 6] {
        DIRS.map(|d| self.add(d))
    }
    pub fn is_adjacent(self, o: Hex) -> bool {
        self.distance(o) == 1
    }
}

/// Board geometry: every hex within `radius` of the origin, in a fixed order.
/// The order is part of the wire format (views address tiles by index).
#[derive(Clone, Debug)]
pub struct Board {
    pub radius: u32,
    hexes: Vec<Hex>,
}

impl Board {
    pub fn new(radius: u32) -> Board {
        let r = radius as i32;
        let mut hexes = Vec::new();
        for q in -r..=r {
            let lo = (-r).max(-q - r);
            let hi = r.min(-q + r);
            for rr in lo..=hi {
                hexes.push(Hex(q, rr));
            }
        }
        Board { radius, hexes }
    }

    pub fn len(&self) -> usize {
        self.hexes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.hexes.is_empty()
    }

    pub fn hexes(&self) -> &[Hex] {
        &self.hexes
    }

    pub fn hex(&self, i: usize) -> Hex {
        self.hexes[i]
    }

    pub fn contains(&self, h: Hex) -> bool {
        h.length() <= self.radius
    }

    /// Index of `h` in the fixed ordering, or `None` off the board.
    pub fn index(&self, h: Hex) -> Option<usize> {
        if !self.contains(h) {
            return None;
        }
        let r = self.radius as i32;
        let mut idx = 0usize;
        for q in -r..h.0 {
            let lo = (-r).max(-q - r);
            let hi = r.min(-q + r);
            idx += (hi - lo + 1) as usize;
        }
        let lo = (-r).max(-h.0 - r);
        Some(idx + (h.1 - lo) as usize)
    }

    /// The ring of hexes at exactly distance `k` from the origin, walked in order.
    pub fn ring(k: u32) -> Vec<Hex> {
        if k == 0 {
            return vec![Hex(0, 0)];
        }
        let mut out = Vec::with_capacity(6 * k as usize);
        let mut h = DIRS[4].scale(k as i32);
        for d in DIRS {
            for _ in 0..k {
                out.push(h);
                h = h.add(d);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(Board::new(4).len(), 61);
        assert_eq!(Board::new(5).len(), 91);
    }

    #[test]
    fn index_roundtrip() {
        let b = Board::new(5);
        for (i, h) in b.hexes().iter().enumerate() {
            assert_eq!(b.index(*h), Some(i));
        }
        assert_eq!(b.index(Hex(6, 0)), None);
    }

    #[test]
    fn rings() {
        for k in 1..6 {
            let ring = Board::ring(k);
            assert_eq!(ring.len(), 6 * k as usize);
            assert!(ring.iter().all(|h| h.length() == k));
            for w in ring.windows(2) {
                assert!(w[0].is_adjacent(w[1]));
            }
        }
    }
}

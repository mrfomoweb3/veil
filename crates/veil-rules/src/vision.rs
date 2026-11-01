//! Who sees what. The fog of war is exactly this function.

use crate::hex::Board;
use crate::state::{GameState, Terrain, SCOUT_RADIUS};

/// Sight range of troops standing on `terrain` looking into `target`.
fn reach(range: u32, target: Terrain) -> Option<u32> {
    if target == Terrain::Forest {
        range.checked_sub(1)
    } else {
        Some(range)
    }
}

/// Visible tiles for player `p`, by tile index. `scout_end` is this turn's surviving scout.
pub fn vision(state: &GameState, board: &Board, p: u8, scout_end: Option<usize>) -> Vec<bool> {
    let mut seen = vec![false; board.len()];
    if !state.players[p as usize].alive {
        return seen;
    }
    let eyes: Vec<(usize, u32)> = state
        .tiles
        .iter()
        .enumerate()
        .filter(|(_, t)| t.owner == Some(p) && t.troops > 0)
        .map(|(i, t)| (i, 1 + t.terrain.sight_bonus()))
        .collect();
    for i in 0..board.len() {
        let t = &state.tiles[i];
        if t.owner == Some(p) {
            seen[i] = true;
            continue;
        }
        let h = board.hex(i);
        let by_troops = eyes
            .iter()
            .any(|&(j, range)| reach(range, t.terrain).is_some_and(|r| board.hex(j).distance(h) <= r));
        let by_scout = scout_end
            .is_some_and(|s| reach(SCOUT_RADIUS, t.terrain).is_some_and(|r| board.hex(s).distance(h) <= r));
        seen[i] = by_troops || by_scout;
    }
    seen
}

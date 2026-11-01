import { describe, expect, it } from 'vitest';
import { bestDirection, padFamily, pressedEdges, radialDeadzone, Repeater, stickDir } from './gamepadMath';

describe('deadzone', () => {
  it('is radial: a small diagonal is dead, a strong one keeps its angle', () => {
    expect(radialDeadzone(0.12, 0.12)).toEqual([0, 0]);
    const [x, y] = radialDeadzone(0.7, 0.7);
    expect(x).toBeCloseTo(y, 6);
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
  });
  it('rescales from the edge of the dead area', () => {
    expect(radialDeadzone(0.21, 0)[0]).toBeLessThan(0.05);
    expect(radialDeadzone(1, 0)[0]).toBeCloseTo(1, 6);
  });
  it('stickDir snaps to 8 directions and ignores light touches', () => {
    expect(stickDir(0.3, 0)).toBeNull();
    expect(stickDir(0.9, 0.1)).toEqual([1, 0]);
    expect(stickDir(0.7, 0.7)).toEqual([0.707, 0.707]);
    expect(stickDir(0, -1)).toEqual([0, -1]);
  });
});

describe('repeat timing', () => {
  it('fires immediately, then after 250 ms, then every 90 ms', () => {
    const r = new Repeater();
    const fired = [0, 100, 249, 250, 300, 339, 340, 430].filter((t) => r.update('up', t));
    expect(fired).toEqual([0, 250, 340, 430]);
  });
  it('restarts on release or a new direction', () => {
    const r = new Repeater();
    expect(r.update('up', 0)).toBe(true);
    expect(r.update(null, 10)).toBe(false);
    expect(r.update('up', 20)).toBe(true);
    expect(r.update('left', 30)).toBe(true);
    expect(r.update('left', 100)).toBe(false);
  });
});

describe('buttons', () => {
  it('fires on press, not while held', () => {
    expect(pressedEdges([false, true, false], [true, true, false])).toEqual([0]);
    expect(pressedEdges([true], [true])).toEqual([]);
  });
});

describe('direction picking', () => {
  const dirs: [number, number][] = [[1, 0], [0.5, -0.87], [-0.5, -0.87], [-1, 0], [-0.5, 0.87], [0.5, 0.87]];
  it('chooses the closest hex neighbour', () => {
    expect(bestDirection([1, 0], dirs)).toBe(0);
    expect(bestDirection([0, -1], dirs)).toBe(1); // tie → first of the two upward neighbours
    expect(bestDirection([-0.6, 0.8], dirs)).toBe(4);
  });
  it('refuses a direction nothing matches', () => {
    expect(bestDirection([1, 0], [[-1, 0]])).toBe(-1);
  });
});

describe('controller family', () => {
  it('reads PlayStation and Xbox ids', () => {
    expect(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padFamily('xinput')).toBe('xbox');
    expect(padFamily('8BitDo Pro 2')).toBe('generic');
  });
});

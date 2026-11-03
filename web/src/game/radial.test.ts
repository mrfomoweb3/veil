import { describe, expect, it } from 'vitest';
import { pickByDirection, radialOptions, type RadialCtx } from './radial';

const base: RadialCtx = { mine: true, troops: 5, fortified: false, target: null, scoutBlock: null, aetherLeft: 10, fortHere: false };
const byId = (c: RadialCtx) => Object.fromEntries(radialOptions(c).map((o) => [o.id, o]));

describe('radial menu', () => {
  it('offers march, scout and fortify on an island of yours with troops', () => {
    const o = byId(base);
    expect([o.march.enabled, o.scout.enabled, o.fort.enabled, o.strike.enabled]).toEqual([true, true, true, false]);
  });

  it('names the strike by what is on the target', () => {
    expect(byId({ ...base, mine: false, troops: 0, target: 'enemy' }).strike.label).toBe('Attack');
    expect(byId({ ...base, mine: false, troops: 0, target: 'unknown' }).strike.label).toBe('Attack into fog');
    expect(byId({ ...base, target: 'friendly' }).strike.label).toBe('Move here');
  });

  it('explains disabled options', () => {
    const o = byId({ ...base, mine: false, troops: 0, scoutBlock: 'Must start on or next to your island', aetherLeft: 0 });
    expect(o.march.why).toBe('Not your island');
    expect(o.fort.why).toBe('Only on your own islands');
    expect(o.scout.enabled).toBe(false);
    expect(byId({ ...base, aetherLeft: 2 }).fort.why).toMatch(/aether/);
    expect(byId({ ...base, fortified: true }).fort.enabled).toBe(false);
  });

  it('lets a drafted fort be cancelled even without aether', () => {
    const o = byId({ ...base, fortHere: true, aetherLeft: 0 });
    expect(o.fort.enabled).toBe(true);
    expect(o.fort.label).toBe('Cancel fort');
  });

  it('picks the slot a push points at, and nothing for a weak diagonal', () => {
    const opts = radialOptions(base);
    expect(pickByDirection(opts, 0, -1)?.id).toBe('march');
    expect(pickByDirection(opts, 1, 0.2)?.id).toBe('scout');
    expect(pickByDirection(opts, 0, 1)?.id).toBe('fort');
    expect(pickByDirection(opts, -1, 0)?.id).toBe('strike');
    expect(pickByDirection(opts, 1, 1)).toBe(null);
    expect(pickByDirection(opts, 0, 0)).toBe(null);
  });
});

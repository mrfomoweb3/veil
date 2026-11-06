import { describe, expect, it } from 'vitest';
import { callsign } from './callsign';

describe('war names', () => {
  it('are stable and readable for browser accounts', () => {
    const a = 'ab'.repeat(32);
    expect(callsign(a)).toBe(callsign(a));
    expect(callsign(a)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it('spread across accounts', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => callsign(i.toString(16).padStart(64, '0'))));
    expect(names.size).toBeGreaterThan(150);
  });
  it('keep named accounts', () => {
    expect(callsign('alice.testnet')).toBe('alice');
    expect(callsign('veil-clouds.near')).toBe('veil-clouds');
  });
});

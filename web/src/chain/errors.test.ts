import { describe, expect, it } from 'vitest';
import { friendlyError } from './errors';

describe('player-facing errors', () => {
  it('turns a contract panic into a sentence', () => {
    const e = friendlyError('{"ActionError":{"index":0,"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: turn deadline passed"}}}}');
    expect(e.message).toBe('This turn ended before your orders arrived. The next turn opens in a moment.');
    expect(e.transient).toBe(false);
    expect(e.raw).toContain('ActionError');
  });
  it('names an unknown refusal without JSON', () => {
    expect(friendlyError('Smart contract panicked: odd thing"}').message).toBe('The game refused that: odd thing.');
  });
  it('marks network trouble as worth retrying', () => {
    const e = friendlyError('{"jsonrpc":"2.0","error":{"name":"HANDLER_ERROR","cause":{"info":{"cause":"NOT_OBSERVED"},"name":"TIMEOUT_ERROR"}}}');
    expect(e.transient).toBe(true);
    expect(e.message).not.toMatch(/[{}]/);
    expect(friendlyError('Failed to fetch').transient).toBe(true);
    expect(friendlyError('{"weird":1}').message).toBe('Something went wrong on the network. Try again.');
  });
});

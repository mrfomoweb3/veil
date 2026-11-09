// What the relayer and the chain say, in words a player can act on. The raw text stays on the
// error (and in the console) for debugging; the player never sees JSON.

export class GameError extends Error {
  constructor(message: string, readonly raw: string, readonly transient: boolean) {
    super(message);
  }
}

const CONTRACT_REASONS: [RegExp, string][] = [
  [/turn deadline passed/i, 'This turn ended before your orders arrived. The next turn opens in a moment.'],
  [/not running/i, 'This match isn’t taking orders right now: it’s resolving a turn or it’s over.'],
  [/turn still open/i, 'The turn is still open.'],
  [/match already started|not in lobby/i, 'That match has already started.'],
  [/lobby is full|no free seat|full/i, 'Every seat in that match is taken.'],
  [/already seated|already in/i, 'You already have a seat in that match.'],
  [/not seated/i, 'You don’t have a seat in that match.'],
  [/only the host/i, 'Only the host can start before every seat is taken.'],
];

export function friendlyError(raw: string): GameError {
  const panic = raw.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) {
    const reason = panic[1].trim();
    const known = CONTRACT_REASONS.find(([re]) => re.test(reason));
    return new GameError(known ? known[1] : `The game refused that: ${reason}.`, raw, false);
  }
  if (/TIMEOUT_ERROR|"Timeout"|timed out|Request timeout/i.test(raw)) {
    return new GameError('The network is slow right now. Your action may still go through; give it a few seconds.', raw, true);
  }
  if (/-429|\b429\b|Rate limit|Too Many Requests/i.test(raw)) return new GameError('The network is busy. Trying again…', raw, true);
  if (/slow down|too many/i.test(raw)) return new GameError('Too many actions at once. Wait a few seconds and try again.', raw, true);
  if (/Failed to fetch|NetworkError|Load failed|relayer HTTP 5\d\d/i.test(raw)) {
    return new GameError('Can’t reach the game server. Check your connection and try again.', raw, true);
  }
  if (/^\s*[{[]/.test(raw)) return new GameError('Something went wrong on the network. Try again.', raw, true);
  return new GameError(raw, raw, false);
}

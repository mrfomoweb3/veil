// The address bar follows the match you're in (`?m=12`), so a reload brings you back to it and
// the same URL is the invite link a friend opens to take a seat.
import { useEffect } from 'react';
import { useStore } from '../store';

export function routeMatch(search = location.search): number | null {
  const v = new URLSearchParams(search).get('m');
  return v && /^\d{1,9}$/.test(v) ? Number(v) : null;
}

export function inviteUrl(id: number, base = location.href): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('m', String(id));
  return u.toString();
}

function writeRoute(id: number | null) {
  const u = new URL(location.href);
  if (id == null) u.searchParams.delete('m');
  else u.searchParams.set('m', String(id));
  if (u.toString() !== location.href) history.replaceState(null, '', u);
}

/** Keeps `?m=` in step with the screen: set inside a match (or its Reveal), cleared elsewhere. */
export function useRouteSync() {
  const screen = useStore((s) => s.screen);
  const matchId = useStore((s) => s.matchId);
  useEffect(() => {
    const inMatch = (screen === 'match' || screen === 'reveal' || screen === 'invite') && matchId != null;
    // Don't clear the link before the app has had a chance to act on it.
    if (!inMatch && screen === 'landing' && !useStore.getState().chain) return;
    writeRoute(inMatch ? matchId : null);
  }, [screen, matchId]);
}

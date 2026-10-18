// Credit is bounded by the server clock and consecutive, plausible media positions.
// A seek, gap or stall earns zero. A stop can flush the valid positions before it;
// subsequent paused time and the first resume boundary always earn zero.
export const WATCH_HEARTBEAT_MS = 15000;
export const WATCH_LEASE_MS = 35000;
export function verifiedWatchMs(
  previous: { at: number; position: number; playing: boolean },
  next: { at: number; position: number; playing: boolean },
  maxPosition: number,
) {
  const elapsed = next.at - previous.at,
    advanced = next.position - previous.position;
  if (
    ![previous.at, previous.position, next.at, next.position, maxPosition].every(Number.isFinite) ||
    maxPosition <= 0 ||
    previous.position < 0 ||
    next.position < 0 ||
    previous.position > maxPosition + 1.5 ||
    !previous.playing ||
    elapsed < 1000 ||
    elapsed > 30000 ||
    advanced <= 0 ||
    next.position > maxPosition + 1.5 ||
    advanced > elapsed / 1000 + 1.5
  )
    return 0;
  // Tiny timestamp jitter never turns into extra watch time; fast playback earns wall time only.
  const boundedAdvance =
    Math.min(next.position, maxPosition) - Math.min(previous.position, maxPosition);
  return Math.max(0, Math.floor(Math.min(elapsed, boundedAdvance * 1000)));
}
export function watchDaySegments(start: number, end: number, credit: number) {
  const offset = 7 * 3600000;
  const day = (at: number) => new Date(at + offset).toISOString().slice(0, 10);
  if (![start, end, credit].every(Number.isFinite) || credit <= 0 || end <= start) return [];
  credit = Math.min(Math.floor(credit), end - start);
  const midnight = Date.parse(day(end) + "T00:00:00+07:00");
  if (start >= midnight) return [{ day: day(end), ms: credit }];
  const current = Math.floor((credit * (end - midnight)) / (end - start));
  return [
    { day: day(start), ms: credit - current },
    { day: day(end), ms: current },
  ].filter((s) => s.ms > 0);
}

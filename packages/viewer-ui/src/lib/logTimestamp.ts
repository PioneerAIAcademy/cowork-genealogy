/** Split a research-log timestamp into the date and the time of day.
 *
 * The cell rendered `entry.performed` raw, so a row read `2026-05-01T10:15:00Z` — a wire
 * format, shown to a genealogist. It is also the widest thing in the narrowest column,
 * which is part of why six columns would not fit without scrolling sideways.
 *
 * The date is what a reader scans and sorts by; the time of day almost never matters but
 * is occasionally the only thing separating two searches, so it is kept and de-emphasised
 * rather than dropped.
 *
 * Deliberately string-slicing rather than `new Date()`: these are stored UTC instants, and
 * parsing them would render them in the viewer's LOCAL zone, silently shifting a research
 * log's dates by a day for anyone east or west of UTC. A log entry's date is part of the
 * evidence trail and must read the same for everyone looking at the same project.
 */
export function splitLogTimestamp(performed: unknown): { date: string; time: string } {
  if (typeof performed !== 'string' || !performed) return { date: '', time: '' }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(performed)
  if (!m) return { date: performed, time: '' }   // unrecognised: show it rather than hide it
  return { date: m[1], time: m[2] ?? '' }
}

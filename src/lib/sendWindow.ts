/**
 * The hours of the day automated WhatsApp messages may go out, in Dominican Republic
 * time (UTC-4 all year — no daylight saving).
 *
 * A recruiting message from an unknown number at 11 p.m. is exactly the kind people
 * block and report — and reports are what get a number banned. Messages queued outside
 * the window simply wait for the morning. Manual 1:1 chat is never held back.
 *
 * Shared by the server (which enforces it) and the screens (which explain it and
 * estimate delivery times), so both always agree.
 */

export const DR_UTC_OFFSET_HOURS = -4;

export interface SendWindow {
  /** First hour messages may go out (0–23). */
  start: number;
  /** Hour they stop (1–24, exclusive): 20 means up to 7:59 p.m. */
  end: number;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { start: 8, end: 20 };

/** "8-20" → 8:00 a.m. to 7:59 p.m.; "off" / "0-24" → always open. Anything invalid
 * falls back to the default rather than silently disabling the protection. */
export function parseSendWindow(spec: string | undefined | null, fallback: SendWindow = DEFAULT_SEND_WINDOW): SendWindow {
  const s = String(spec ?? '').trim();
  if (!s) return fallback;
  if (/^(off|no|0-24|24h)$/i.test(s)) return { start: 0, end: 24 };
  const m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return fallback;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 0 || start > 23 || end < 1 || end > 24 || start >= end) return fallback;
  return { start, end };
}

const isAlwaysOpen = (w: SendWindow) => w.start <= 0 && w.end >= 24;

/** The moment as DR wall-clock time, read with the getUTC* methods. */
const drClock = (ms: number) => new Date(ms + DR_UTC_OFFSET_HOURS * 3_600_000);

export function isWithinSendWindow(nowMs: number, w: SendWindow): boolean {
  if (isAlwaysOpen(w)) return true;
  const h = drClock(nowMs).getUTCHours();
  return h >= w.start && h < w.end;
}

/** When automated sending next opens — `nowMs` itself if it's open now. */
export function nextSendWindowOpenMs(nowMs: number, w: SendWindow): number {
  if (isWithinSendWindow(nowMs, w)) return nowMs;
  const c = drClock(nowMs);
  const todayAtStart = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), w.start, 0, 0);
  const drTarget = c.getUTCHours() < w.start ? todayAtStart : todayAtStart + 86_400_000;
  return drTarget - DR_UTC_OFFSET_HOURS * 3_600_000;
}

/** Minutes left before today's window closes (0 when closed; Infinity when always open). */
export function minutesLeftInWindow(nowMs: number, w: SendWindow): number {
  if (isAlwaysOpen(w)) return Infinity;
  if (!isWithinSendWindow(nowMs, w)) return 0;
  const c = drClock(nowMs);
  const closeAt = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), w.end, 0, 0);
  return Math.max(0, Math.floor((closeAt - c.getTime()) / 60_000));
}

/** "8:00 a. m." style label for an hour of the window. */
export function formatWindowHour(hour: number): string {
  if (hour === 24 || hour === 0) return '12:00 a. m.';
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${suffix}`;
}

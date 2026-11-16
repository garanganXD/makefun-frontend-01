// format.js — pure, dependency-free helpers that turn raw API values into display
// strings. No DOM, no network, no shared state: every export is a value -> string
// (or number) mapping, so each is trivially testable and side-effect free.

const DASH = '\u2014'; // em dash, for "not available"

/** Escape a value for safe interpolation into HTML text or an attribute value. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A finite number from a number, a decimal string, or nothing (NaN). */
function num(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** A dollar amount: '$250', '$652.50', '$0.50'; '—' when absent or not a number. */
export function money(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return DASH;
  const neg = n < 0;
  const a = Math.abs(n);
  const cents = Math.round(a * 100) % 100 !== 0;
  const s = a.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return (neg ? '\u2212$' : '$') + s;
}

/** Micro-dollars (a decimal string, 1e6 micro == $1) as dollars, for build costs. */
export function microUsd(v) {
  const n = num(v);
  return Number.isFinite(n) ? money(n / 1e6) : DASH;
}

/** An absolute instant in UTC: 'Nov 16, 2026 · 10:06 UTC'. */
export function date(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return (
    d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC'
  );
}

/** Whole seconds from now until an instant (negative once it is past). */
export function deltaSec(iso) {
  return (new Date(iso).getTime() - Date.now()) / 1000;
}

/** Time until a deadline, for a live countdown: '2d 4h', '3h 12m', '4m 05s', 'ended'. */
export function timeLeft(iso) {
  const s = Math.floor(deltaSec(iso));
  if (Number.isNaN(s)) return '';
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s % 60}s left`;
  return `${s}s left`;
}

/** A past time as 'just now', '5m ago', '3h ago', '2d ago', '3mo ago', '2y ago'. */
export function ago(iso) {
  const s = Math.floor(-deltaSec(iso));
  if (Number.isNaN(s)) return '';
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Rough count: 62 -> '62', 6236 -> '6.2k', 1.2e6 -> '1.2m'. */
export function compact(n) {
  const v = num(n);
  if (!Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (a >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

/** A byte count as '645 KB', '3.2 MB'; '—' when absent. */
export function bytes(n) {
  const v = num(n);
  if (!Number.isFinite(v) || v < 0) return DASH;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB'];
  let x = v;
  let u = -1;
  while (x >= 1024 && u < units.length - 1) { x /= 1024; u++; }
  const s = x >= 100 ? String(Math.round(x)) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return `${s} ${units[u]}`;
}

/**
 * A leaderboard metric, humanised from its column's source and raw value. The API
 * ships rates in micro units (a win rate of 95.06% arrives as 950587) and costs in
 * micro-dollars; elsewhere it ships plain counts and byte sizes. When nothing is
 * recognised the value is grouped with thousands separators, and `display` (the
 * server's own string) is the fallback when the value is missing.
 */
export function metric(column, value, display) {
  const src = String(column?.source ?? '');
  const key = String(column?.key ?? '');
  const title = String(column?.title ?? '');
  const v = num(value);
  if (!Number.isFinite(v)) return display ?? DASH;

  if (src.endsWith('_micro') && /(rate|interval)/i.test(src + key)) {
    return (v / 10000).toFixed(2).replace(/\.00$/, '') + '%';
  }
  if (/micro/.test(src) && /(usd|cost|price)/i.test(src + key)) {
    return money(v / 1e6);
  }
  if (/(byte|size|artifact)/i.test(src + ' ' + title + ' ' + key)) {
    return bytes(v);
  }
  const rounded = Math.round(v);
  return Number.isFinite(rounded) && String(v) === String(rounded)
    ? rounded.toLocaleString('en-US')
    : String(v);
}

/** A short class from a category slug, for the chip colour. */
export function catClass(cat) {
  return 'cat-' + String(cat ?? 'other').toLowerCase().replace(/[^a-z]/g, '');
}

/** Deadline urgency class: soon (<3h), today (<24h), calm, or ended. */
export function urgency(iso) {
  const s = deltaSec(iso);
  if (Number.isNaN(s)) return 'calm';
  if (s <= 0) return 'ended';
  if (s < 3 * 3600) return 'soon';
  if (s < 24 * 3600) return 'today';
  return 'calm';
}

// format.js — pure, dependency-free helpers for rendering API values.
// No DOM, no network: every function is a string -> string (or number) mapping.

/** Escape a value for safe interpolation into HTML text or an attribute. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A dollar amount from a number or a decimal string: '$500', '$12.50', '—' when absent. */
export function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + s;
}

/** Micro-dollars (a decimal string, 1e6 micro == $1) as dollars, for an entry's build cost. */
export function microUsd(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return money(n / 1e6);
}

/** An absolute instant in UTC: 'Nov 24, 2026 · 17:00 UTC'. */
export function date(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}

/** Seconds from now until an instant (negative once it is past). */
function delta(iso) {
  return (new Date(iso).getTime() - Date.now()) / 1000;
}

/** Time until a deadline, for a live countdown: '2d 4h', '3h 12m', '4m 05s', 'ended'. */
export function timeLeft(iso) {
  const s = Math.floor(delta(iso));
  if (Number.isNaN(s)) return '';
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${sec}s left`;
  return `${sec}s left`;
}

/** A past time as 'just now', '5m ago', '3h ago', '2d ago', '3mo ago'. */
export function ago(iso) {
  const s = Math.floor(-delta(iso));
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

/** Rough number: 62 -> '62', 6236 -> '6.2k', 1.2e6 -> '1.2m'. */
export function compact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

/** A short class from a category slug, for the chip colour. */
export function catClass(cat) {
  return 'cat-' + String(cat ?? 'other').toLowerCase().replace(/[^a-z]/g, '');
}

/** Deadline urgency class: soon (<3h), today (<24h), calm, or ended. */
export function urgency(iso) {
  const s = delta(iso);
  if (Number.isNaN(s)) return 'calm';
  if (s <= 0) return 'ended';
  if (s < 3 * 3600) return 'soon';
  if (s < 24 * 3600) return 'today';
  return 'calm';
}

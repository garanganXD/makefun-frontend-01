// api.js — a minimal, robust GET-only client for make.fun's public API (CORS is
// open). It revalidates with If-None-Match against the ETag the API sets on every
// JSON route (exposed via Access-Control-Expose-Headers), so a quiet auto-refresh
// costs a 304 round-trip instead of re-downloading the body; it backs off and
// retries when the API rate-limits (HTTP 429); and it keeps a short in-memory TTL
// so back-to-back renders of the same page never hit the network twice.

const BASE = 'https://make.fun/api';

const etags = new Map();   // path -> ETag, sent back as If-None-Match
const bodies = new Map();  // path -> last parsed body, reused on a 304
const memo = new Map();    // path -> { t, data } short in-memory TTL

const TTL = 20000;         // ms before a memoised value is re-fetched
const TIMEOUT = 15000;     // ms fetch timeout
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An error the views can tell apart: kind is 'network' or 'http', status is the HTTP code (0 for network). */
function ApiError(kind, message, status) {
  const e = new Error(message);
  e.name = 'ApiError';
  e.kind = kind;
  e.status = status ?? 0;
  return e;
}

async function request(path, retries = MAX_RETRIES) {
  const headers = { accept: 'application/json' };
  const etag = etags.get(path);
  if (etag) headers['if-none-match'] = etag;

  let res;
  try {
    res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw ApiError('network', "Couldn't reach make.fun — check your connection.", 0);
  }

  // Rate limit: honour Retry-After when given, otherwise exponential backoff, then retry.
  if (res.status === 429 && retries > 0) {
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0
      ? Math.min(ra * 1000, 15000)
      : Math.min(1000 * 2 ** (MAX_RETRIES - retries), 15000);
    await sleep(wait);
    return request(path, retries - 1);
  }

  // Not modified: reuse the body we already hold.
  if (res.status === 304) {
    if (bodies.has(path)) return { data: bodies.get(path), fresh: false, status: 304 };
    return request(path, 0); // body lost (page reload): fetch unconditionally
  }

  if (!res.ok) {
    const msg = res.status === 404 ? 'Not found' : `Request failed (HTTP ${res.status})`;
    throw ApiError('http', msg, res.status);
  }

  const et = res.headers.get('etag');
  if (et) etags.set(path, et);
  const data = await res.json();
  bodies.set(path, data);
  return { data, fresh: true, status: res.status };
}

/** Fetch a path and memoise it briefly. Resolves { data, fresh, status }. */
export async function getJSON(path, ttl = TTL) {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.t < ttl) return { data: hit.data, fresh: false, memo: true };
  const out = await request(path);
  memo.set(path, { t: Date.now(), data: out.data });
  return out;
}

export const compPath = (slug) => '/competitions/' + encodeURIComponent(slug);

/** The open (or resolved) board. activity=times trims the chat/submission feeds a board never shows. */
export function getBoard(status = 'open') {
  return getJSON(`/competitions?status=${encodeURIComponent(status)}&activity=times`);
}

/**
 * One competition, full detail, by slug. submissions=summary drops the (large)
 * per-entry submissions list the detail view never shows, keeping the payload lean.
 */
export function getBounty(slug) {
  return getJSON(compPath(slug) + '?submissions=summary');
}

/**
 * A competition's leaderboard. rows=first keeps the payload lean: the top 10
 * entries in full detail plus every other entry as a light row (rank, handle,
 * title, the primary metric and received time) instead of all rows in full.
 */
export function getLeaderboard(slug, view) {
  const q = view ? `?view=${encodeURIComponent(view)}&rows=first` : '?rows=first';
  return getJSON(compPath(slug) + '/leaderboard' + q);
}

/** An account's public profile by handle. */
export function getAccount(handle) {
  return getJSON('/profiles/' + encodeURIComponent(handle));
}

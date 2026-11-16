// api.js — a tiny fetch wrapper for make.fun's public API (GET only, CORS open).
//
// It revalidates with If-None-Match when the API sends an ETag (the API sets one
// on every JSON route and exposes it via Access-Control-Expose-Headers), so an
// auto-refresh costs a 304 round-trip instead of re-downloading the body. It also
// backs off and retries when the API rate-limits (HTTP 429), and keeps a short
// in-memory TTL so back-to-back renders don't hit the network.

const BASE = 'https://make.fun/api';

const etags = new Map();   // path -> ETag, for If-None-Match
const bodies = new Map();  // path -> last parsed body, reused on 304
const memo = new Map();    // path -> { t, data } short in-memory TTL

const TTL = 20000;         // ms before a value is re-fetched
const TIMEOUT = 15000;     // ms fetch timeout

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function err(kind, message, status) {
  return Object.assign(new Error(message), { kind, status });
}

async function req(path, retries = 3) {
  const headers = { accept: 'application/json' };
  const etag = etags.get(path);
  if (etag) headers['if-none-match'] = etag;

  let res;
  try {
    res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw err('network', "Couldn't reach make.fun — check your connection", 0);
  }

  // Rate limit: honour Retry-After when given, otherwise back off 2s, and retry.
  if (res.status === 429 && retries > 0) {
    const ra = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10000) : 2000;
    await sleep(wait);
    return req(path, retries - 1);
  }

  // Not modified: reuse the body we already hold.
  if (res.status === 304) {
    if (bodies.has(path)) return { data: bodies.get(path), fresh: false, status: 304 };
    return req(path, 0); // body lost (page reload): fetch unconditionally
  }

  if (!res.ok) {
    throw err('http', res.status === 404 ? 'Not found' : `Request failed (HTTP ${res.status})`, res.status);
  }

  const et = res.headers.get('etag');
  if (et) etags.set(path, et);
  const data = await res.json();
  bodies.set(path, data);
  return { data, fresh: true, status: res.status };
}

/** Fetch a path and cache it briefly. Resolves { data, fresh, status }. */
export async function getJSON(path, ttl = TTL) {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.t < ttl) return { data: hit.data, fresh: false, memo: true };
  const out = await req(path);
  memo.set(path, { t: Date.now(), data: out.data });
  return out;
}

export const compPath = (slug) => '/competitions/' + encodeURIComponent(slug);

/** The open (or resolved) board. activity=times trims what a board never shows. */
export function getBoard(status = 'open') {
  return getJSON(`/competitions?status=${encodeURIComponent(status)}&activity=times`);
}

/**
 * One competition, full detail, by slug. submissions=summary drops the (huge)
 * per-entry submissions list the detail view never shows, so the payload stays
 * small and fast.
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

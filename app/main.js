// main.js — the router and app wiring: hash routes, a quiet auto-refresh, a live
// countdown/ago ticker, and delegated UI events. window.__shotReady flips true once
// a page's data is painted, so a screenshot script knows when to capture.
//
//   #/                        the live board
//   #/bounty/<slug>           one bounty, full detail
//   #/leaderboard/<slug>      that bounty's ranked entries
//   #/profile/<handle>        an account's public profile

import { getAccount, getBoard, getBounty, getLeaderboard } from './api.js';
import { ago, timeLeft, urgency } from './format.js';
import { board, bounty, cardList, error, filterItems, leaderboard, loading, profile } from './views.js';

const app = document.getElementById('app');

// UI state that survives re-renders (search, category, sort, leaderboard view).
const ui = { q: '', cat: '', sort: 'pot', lbView: null };
let lastBoard = [];
let seq = 0;         // route token: drop stale renders that land out of order
let navigated = false;

function setTitle(t) {
  document.title = t ? `${t} | make.fun` : 'make.fun bounties';
}

function show(html, scroll = true) {
  app.innerHTML = html;
  if (scroll) window.scrollTo(0, 0);
  if (navigated) app.focus({ preventScroll: true });
}

function markLive() {
  const live = document.getElementById('live');
  if (live) live.dataset.at = Date.now();
}

/** Wrap a view render: loading shell first, data when it lands, error shell on failure. */
async function stage(token, opts, load, paint) {
  window.__shotReady = false;
  if (!opts.silent) show(loading(), opts.scroll !== false);
  let out;
  try {
    out = await load();
  } catch (e) {
    if (token !== seq) return;
    if (opts.silent) { window.__shotReady = true; return; } // keep last content on a quiet refresh
    setTitle('Error');
    show(error(e), true);
    window.__shotReady = true;
    return;
  }
  if (token !== seq) return;
  show(paint(out), opts.scroll !== false);
  markLive();
  window.__shotReady = true;
}

async function render(opts = {}) {
  const token = ++seq;
  const hash = location.hash || '#/';
  let m;

  if ((m = hash.match(/^#\/bounty\/([^/?#]+)/))) {
    const slug = decodeURIComponent(m[1]);
    await stage(token, opts, () => getBounty(slug), (out) => {
      setTitle(out.data?.title);
      return bounty(out.data);
    });
  } else if ((m = hash.match(/^#\/leaderboard\/([^/?#]+)/))) {
    const slug = decodeURIComponent(m[1]);
    await stage(token, opts, () => getLeaderboard(slug, ui.lbView), (out) => {
      setTitle(out.data?.competition?.title ?? 'Leaderboard');
      return leaderboard(slug, out.data);
    });
  } else if ((m = hash.match(/^#\/profile\/([^/?#]+)/))) {
    const handle = decodeURIComponent(m[1]);
    await stage(token, opts, () => getAccount(handle), (out) => {
      setTitle('@' + (out.data?.handle ?? handle));
      return profile(out.data, handle);
    });
  } else {
    await stage(token, opts, () => getBoard('open'), (out) => {
      lastBoard = out.data?.items ?? [];
      setTitle(null);
      return board(lastBoard, ui);
    });
  }
}

/** Re-render just the board's list and count from cached data (no fetch, keeps focus). */
function repaintBoard() {
  const cards = document.getElementById('cards');
  const count = document.getElementById('count');
  if (!cards) return;
  const filtered = filterItems(lastBoard, ui);
  cards.innerHTML = cardList(filtered);
  if (count) count.textContent = String(filtered.length);
}

// ---- delegated events ------------------------------------------------------

document.addEventListener('click', (e) => {
  const t = e.target;
  const tab = t.closest('.viewtab');
  if (tab) {
    ui.lbView = tab.dataset.view || null;
    render();
    return;
  }
  const cat = t.closest('.chip-btn');
  if (cat) {
    ui.cat = cat.dataset.cat || '';
    document.querySelectorAll('.chip-btn').forEach((b) => {
      const on = (b.dataset.cat || '') === ui.cat;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    repaintBoard();
    return;
  }
  if (t.closest('[data-retry]')) render();
});

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'search') {
    ui.q = e.target.value;
    repaintBoard();
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'sort') {
    ui.sort = e.target.value;
    repaintBoard();
  }
});

window.addEventListener('hashchange', () => { navigated = true; render(); });

// ---- live ticker: relative times update in place, no re-render -------------

setInterval(() => {
  if (document.hidden) return;
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    el.textContent = timeLeft(el.dataset.countdown);
    el.classList.remove('soon', 'today', 'calm', 'ended');
    el.classList.add(urgency(el.dataset.countdown));
  });
  document.querySelectorAll('[data-ago]').forEach((el) => {
    el.textContent = ago(el.dataset.ago);
  });
  const live = document.getElementById('live');
  if (live && live.dataset.at) {
    const s = Math.floor((Date.now() - Number(live.dataset.at)) / 1000);
    live.title = s < 60 ? 'updated just now' : `updated ${Math.floor(s / 60)}m ago`;
  }
}, 1000);

// ---- auto-refresh (ETag-revalidated, quiet so scroll/focus are preserved) ---

setInterval(() => {
  if (document.hidden) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
  render({ scroll: false, silent: true });
}, 60000);

render();

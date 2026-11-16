// views.js — the four surfaces (board, bounty, leaderboard, profile) as pure
// functions from API data to HTML, plus the shared loading/error/empty shells and
// a small, safe markdown renderer for the descriptions and rules. Every value that
// reaches the markup is escaped; links use hash routes so each surface has its own URL.

import { ago, catClass, compact, date, esc, money, timeLeft, urgency } from './format.js';

// ---- shared shells ---------------------------------------------------------

export function loading(label = 'Loading') {
  return `<div class="state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>${esc(label)}…</div>`;
}

export function error(e) {
  const msg = e?.message ?? 'Something went wrong';
  return `
    <div class="state state-error" role="alert">
      <p class="err-ico" aria-hidden="true">!</p>
      <p class="err-title">Couldn't load this page</p>
      <p class="err-msg">${esc(msg)}</p>
      <p class="err-actions">
        <a class="btn" href="#/">Back to the board</a>
        <button class="btn btn-ghost" type="button" data-retry>Try again</button>
      </p>
    </div>`;
}

export function empty(what) {
  return `<div class="state"><p>Nothing here yet — ${esc(what)}.</p></div>`;
}

// ---- a small, safe markdown renderer (headings, lists, code, bold, links) ----

function link(text, url) {
  const safe = /^https?:\/\//i.test(url) ? url : null;
  if (!safe) return esc(text);
  return `<a href="${esc(safe)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
}

/** Inline markdown: code spans, links, then **bold** and *italic* — the rest escaped. */
function inline(s) {
  const stash = [];
  const st = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
  let out = String(s ?? '');
  out = out.replace(/`([^`]+)`/g, (_, c) => st(`<code>${esc(c)}</code>`));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => st(link(t, u)));
  out = esc(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  return out;
}

/** A compact markdown renderer for descriptions and rules (fenced code, headings, lists). */
export function md(src) {
  const text = String(src ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';
  const lines = text.split('\n');
  let html = '';
  let i = 0;
  let list = null; // 'ul' | 'ol'

  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip the closing fence
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(h[1].length + 1, 4); // '#' becomes h2 (the page h1 is the title)
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      i++;
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
      i++;
      continue;
    }
    if (line.trim() === '') { closeList(); i++; continue; }
    // paragraph: gather consecutive plain lines
    closeList();
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```|^\s*[-*]\s|^\s*\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    html += `<p>${inline(para.join(' '))}</p>`;
  }
  closeList();
  return html;
}

// ---- small shared helpers --------------------------------------------------

const siteUrl = (p) => (p ? (/^https?:\/\//.test(p) ? p : 'https://make.fun' + p) : '');

const pot = (b) => money(b.potUsd ?? b.rewardAmount);

const fee = (b) => {
  const f = Number(b.entryFeeUsd ?? b.entryFeesUsd ?? 0);
  return f > 0 ? `${money(f)} entry` : 'free entry';
};

// ---- board (#/) ------------------------------------------------------------

function card(b) {
  const skills = (b.skills ?? []).slice(0, 3);
  const sponsor = b.sponsor?.name ? `
    <span class="by">by <span class="${b.sponsor.isVerified ? 'verified' : ''}">${esc(b.sponsor.name)}${b.sponsor.isVerified ? ' ✓' : ''}</span></span>` : '';
  return `
    <li class="card">
      <div class="card-top">
        <span class="chip ${catClass(b.category)}">${esc(b.category ?? 'bounty')}</span>
        <span class="time ${urgency(b.deadline)}" data-countdown="${esc(b.deadline ?? '')}">${esc(timeLeft(b.deadline))}</span>
      </div>
      <a class="card-title" href="#/bounty/${encodeURIComponent(b.slug)}">${esc(b.title)}</a>
      <div class="card-nums">
        <span class="pot" title="live pot">${pot(b)}</span>
        <span class="fee">${esc(fee(b))}</span>
        <span class="entries">${compact(b.submissionCount)} entries</span>
      </div>
      <div class="card-meta">
        ${sponsor}
        ${skills.length ? `<span class="skills">${skills.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</span>` : ''}
      </div>
    </li>`;
}

/** Filter and sort the board in place of a network call. */
export function filterItems(items, ui = {}) {
  const q = (ui.q ?? '').trim().toLowerCase();
  const cat = ui.cat ?? '';
  let list = items.filter((b) => {
    if (cat && (b.category ?? '') !== cat) return false;
    if (q) {
      const hay = `${b.title} ${b.summary ?? ''} ${b.category ?? ''} ${(b.skills ?? []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sort = ui.sort ?? 'pot';
  list = list.slice().sort((a, b) => {
    switch (sort) {
      case 'deadline': return String(a.deadline ?? '').localeCompare(String(b.deadline ?? ''));
      case 'entries': return (b.submissionCount ?? 0) - (a.submissionCount ?? 0);
      case 'new': return String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''));
      default: return Number(b.potUsd ?? b.rewardAmount ?? 0) - Number(a.potUsd ?? a.rewardAmount ?? 0);
    }
  });
  return list;
}

export function toolbar(items, ui = {}) {
  const cats = [...new Set(items.map((b) => b.category ?? 'Other'))].sort();
  const q = ui.q ?? '';
  const cat = ui.cat ?? '';
  return `
    <div class="toolbar">
      <label class="search">
        <span class="sr-only">Search bounties</span>
        <input id="search" type="search" inputmode="search" placeholder="Search bounties…" value="${esc(q)}" aria-label="Search bounties" autocomplete="off">
      </label>
      <div class="cats" role="group" aria-label="Filter by category">
        <button class="chip-btn ${!cat ? 'is-on' : ''}" type="button" data-cat="" aria-pressed="${!cat}">All</button>
        ${cats.map((c) => `<button class="chip-btn ${cat === c ? 'is-on' : ''}" type="button" data-cat="${esc(c)}" aria-pressed="${cat === c}">${esc(c)}</button>`).join('')}
      </div>
      <label class="sort">
        <span class="sr-only">Sort bounties</span>
        <select id="sort" aria-label="Sort bounties">
          <option value="pot" ${ui.sort === 'pot' ? 'selected' : ''}>Highest pot</option>
          <option value="deadline" ${ui.sort === 'deadline' ? 'selected' : ''}>Ending soonest</option>
          <option value="entries" ${ui.sort === 'entries' ? 'selected' : ''}>Most entries</option>
          <option value="new" ${ui.sort === 'new' ? 'selected' : ''}>Newest</option>
        </select>
      </label>
    </div>`;
}

export function cardList(items) {
  if (!items.length) return `<li class="state inline"><p>No bounties match — try clearing your search or filters.</p></li>`;
  return items.map(card).join('');
}

export function board(items, ui = {}) {
  const filtered = filterItems(items, ui);
  return `
    ${toolbar(items, ui)}
    <section aria-label="Bounties">
      <div class="head">
        <h1>Open bounties</h1>
        <span class="count" id="count">${filtered.length}</span>
      </div>
      <ul class="board" id="cards">${cardList(filtered)}</ul>
    </section>`;
}

// ---- bounty (#/bounty/<slug>) ---------------------------------------------

export function bounty(b) {
  const rewards = (b.rewardsNow ?? []).filter((r) => Number(r.amountUsd) > 0).slice(0, 10);
  const skills = b.skills ?? [];
  const phases = b.phases ?? [];
  const opened = b.opensAt && new Date(b.opensAt).getTime() > Date.now();
  const prizeShare = rewards.reduce((sum, r) => sum + Number(r.amountUsd || 0), 0);

  return `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">← All bounties</a></nav>
    <article class="detail">
      <header>
        <div class="chips">
          <span class="chip ${catClass(b.category)}">${esc(b.category ?? 'bounty')}</span>
          ${b.status ? `<span class="chip">${esc(b.status)}</span>` : ''}
          ${b.sponsor?.isVerified ? `<span class="chip chip-ok">✓ verified sponsor</span>` : ''}
        </div>
        <h1>${esc(b.title)}</h1>
        ${b.summary ? `<p class="summary">${esc(b.summary)}</p>` : ''}
      </header>

      <dl class="facts">
        <div><dt>Live pot</dt><dd class="pot">${money(b.potUsd ?? b.rewardAmount)}</dd></div>
        <div><dt>Entry fee</dt><dd>${esc(fee(b))}</dd></div>
        <div><dt>Entries</dt><dd>${compact(b.submissionCount)}</dd></div>
        <div><dt>Base prize</dt><dd>${money(b.rewardAmount)}</dd></div>
        <div><dt>Deadline</dt><dd class="dd-time">${date(b.deadline)} <span class="time ${urgency(b.deadline)}" data-countdown="${esc(b.deadline ?? '')}">${esc(timeLeft(b.deadline))}</span></dd></div>
        ${b.opensAt ? `<div><dt>${opened ? 'Opens' : 'Opened'}</dt><dd>${date(b.opensAt)}</dd></div>` : ''}
        ${b.sponsor?.name ? `<div><dt>Sponsor</dt><dd>${esc(b.sponsor.name)}</dd></div>` : ''}
        ${prizeShare > 0 ? `<div><dt>Prize pool</dt><dd>${money(prizeShare)}</dd></div>` : ''}
      </dl>

      ${skills.length ? `<p class="skills-line">${skills.map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')}</p>` : ''}

      <p class="links">
        <a class="btn" href="#/leaderboard/${encodeURIComponent(b.slug)}">View leaderboard</a>
        ${b.url ? `<a class="btn btn-ghost" href="${esc(siteUrl(b.url))}" rel="noopener noreferrer" target="_blank">On make.fun ↗</a>` : ''}
      </p>

      ${rewards.length ? `
        <h2>Prize pool</h2>
        <ol class="prizes">${rewards.map((r) => `<li><span class="place">#${esc(r.place)}</span><span class="amt">${money(r.amountUsd)}</span></li>`).join('')}</ol>` : ''}

      ${phases.length ? `
        <h2>Timeline</h2>
        <ol class="phases">${phases.map((p) => `<li><strong>${esc(p.title ?? p.key)}</strong> <span class="dim">${p.startsAt ? date(p.startsAt) : ''}${p.endsAt ? ' – ' + date(p.endsAt) : ''}</span></li>`).join('')}</ol>` : ''}

      <h2>Description</h2>
      <div class="prose">${md(b.description)}</div>

      ${b.rules ? `
        <details class="rules">
          <summary>Full rules &amp; requirements</summary>
          ${b.rulesNote?.text ? `<p class="note">${esc(b.rulesNote.text)}</p>` : ''}
          <div class="prose">${md(b.rules)}</div>
        </details>` : ''}
    </article>`;
}

// ---- leaderboard (#/leaderboard/<slug>) ------------------------------------

function topClass(r) {
  const n = Number(r);
  if (n === 1) return 'top-1';
  if (n === 2) return 'top-2';
  if (n === 3) return 'top-3';
  return '';
}

function rowFull(e, columns) {
  const who = e.handle ?? '';
  const cls = (e.baseline || e.house) ? 'row-house' : (e.prize_eligible === false ? 'row-off' : '');
  const cells = columns.map((c) => `<td class="num">${esc(e.display?.[c.key] ?? e.values?.[c.key] ?? '—')}</td>`).join('');
  return `
    <tr class="${cls}">
      <td class="rank ${topClass(e.rank)}">${esc(e.rank ?? '—')}</td>
      <td class="who">${who ? `<a href="#/profile/${encodeURIComponent(who)}">${esc(who)}</a>` : '—'}</td>
      <td class="etitle">${esc(e.title ?? '')}</td>
      ${cells}
      <td class="num ftime" data-ago="${esc(e.received_at ?? '')}">${esc(ago(e.received_at))}</td>
    </tr>`;
}

function rowLight(e) {
  const who = e.handle ?? '';
  const cls = (e.baseline || e.house) ? 'row-house' : (e.prize_eligible === false ? 'row-off' : '');
  return `
    <tr class="${cls}">
      <td class="rank">${esc(e.rank ?? '—')}</td>
      <td class="who">${who ? `<a href="#/profile/${encodeURIComponent(who)}">${esc(who)}</a>` : '—'}</td>
      <td class="etitle">${esc(e.title ?? '')}</td>
      <td class="num">${esc(e.display ?? '')}</td>
      <td class="num ftime" data-ago="${esc(e.received_at ?? '')}">${esc(ago(e.received_at))}</td>
    </tr>`;
}

export function leaderboard(slug, d) {
  if (!d || (!(d.entries ?? []).length && !(d.rest ?? []).length)) {
    return empty('no entries yet — be the first');
  }
  const comp = d.competition ?? {};
  const phase = d.phase ?? {};
  const columns = (d.columns ?? []).filter((c) => !c.hidden);
  const full = d.entries ?? [];
  const rest = d.rest ?? [];
  const views = d.views ?? [];
  const current = d.view;
  const total = full.length + rest.length;

  const primary = columns.find((c) => c.key === d.rank_key) ?? columns[0];
  const primaryTitle = primary?.title ?? d.rank_key ?? 'Score';

  const tabs = views.length > 1 ? `
    <div class="views" role="tablist" aria-label="Leaderboard view">
      ${views.map((v) => `<button class="viewtab ${v === current ? 'is-on' : ''}" type="button" role="tab" aria-selected="${v === current}" data-view="${esc(v)}">${esc(v)}</button>`).join('')}
    </div>` : '';

  const headCells = columns.map((c) => `<th scope="col" class="num">${esc(c.title)}</th>`).join('');

  const shownField = rest.slice(0, 90);
  const shown = full.length + shownField.length;

  return `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/bounty/${encodeURIComponent(slug)}">← ${esc(comp.title ?? 'Bounty')}</a></nav>
    <div class="head">
      <h1>Leaderboard</h1>
      <span class="count">${compact(total)} entries</span>
    </div>
    ${phase.title ? `<p class="phase-line"><span class="dot" aria-hidden="true"></span>${esc(phase.title)}${phase.scores === 'live' ? ' — scores update live' : ''}${phase.placements_held ? ' · placements held until results' : ''}</p>` : ''}
    ${d.metrics_withheld ? `<p class="note">Detailed metrics are withheld during practice; showing the leaderboard head.</p>` : ''}
    ${tabs}

    <div class="tablewrap"><table class="lb">
      <thead><tr><th scope="col">#</th><th scope="col">Entrant</th><th scope="col">Entry</th>${headCells}<th scope="col" class="num">Submitted</th></tr></thead>
      <tbody>${full.map((e) => rowFull(e, columns)).join('')}</tbody>
    </table></div>

    ${shownField.length ? `
      <h2 class="more-h">The rest of the field</h2>
      <div class="tablewrap"><table class="lb">
        <thead><tr><th scope="col">#</th><th scope="col">Entrant</th><th scope="col">Entry</th><th scope="col" class="num">${esc(primaryTitle)}</th><th scope="col" class="num">Submitted</th></tr></thead>
        <tbody>${shownField.map(rowLight).join('')}</tbody>
      </table></div>` : ''}

    ${total > shown ? `<p class="note">Showing the top ${shown} of ${compact(total)} entries — see the full list on make.fun.</p>` : ''}
  `;
}

// ---- profile (#/profile/<handle>) ------------------------------------------

export function profile(a, handle) {
  if (!a || !a.handle) return empty('no account by that handle');
  const h = a.handle ?? handle;
  const rec = a.record ?? {};

  const stats = [
    ['Entered', rec.competitions_entered],
    ['Placed', rec.competitions_placed],
    ['Won', rec.competitions_won],
    ['Podiums', rec.podium_finishes],
    ['Best place', rec.best_placement],
    ['Prizes', rec.prize_usd != null ? money(rec.prize_usd) : null],
  ].filter(([, v]) => v !== null && v !== undefined);

  const links = [];
  if (a.github_login) links.push(['GitHub', `https://github.com/${a.github_login}`]);
  if (a.x) links.push(['X / Twitter', `https://x.com/${a.x}`]);
  if (a.discord) links.push(['Discord', null]);
  if (a.wallet?.address) links.push(['Wallet', a.wallet.explorer_url]);

  const avatarRaw = (typeof a.avatar === 'object' && a.avatar) ? (a.avatar.url_small || a.avatar.url) : null;
  const avatarUrl = avatarRaw || a.image || null;

  const solutions = a.solutions ?? [];
  const solList = solutions.map((s) => {
    const c = s.competition ?? {};
    const sc = s.score ?? {};
    return `
      <li class="sol">
        <div class="sol-main">
          <a class="sol-title" href="#/bounty/${encodeURIComponent(c.slug ?? '')}">${esc(c.title ?? s.title ?? 'Untitled entry')}</a>
          <div class="sol-sub">
            ${c.category ? `<span class="chip ${catClass(c.category)}">${esc(c.category)}</span>` : ''}
            <span class="dim">${s.entered_at ? `entered ${ago(s.entered_at)}` : ''}${c.status ? ` · ${esc(c.status)}` : ''}</span>
          </div>
        </div>
        <div class="sol-side">
          ${s.placement != null ? `<span class="chip chip-top">place #${esc(s.placement)}</span>` : ''}
          ${s.prize_usd != null && Number(s.prize_usd) > 0 ? `<span class="chip chip-ok">${money(s.prize_usd)}</span>` : ''}
          ${sc.display != null ? `<span class="chip">${esc(sc.column?.title ?? 'score')} ${esc(sc.display)}</span>` : ''}
        </div>
      </li>`;
  }).join('');

  return `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">← All bounties</a></nav>
    <article class="profile">
      <header class="phead">
        ${avatarUrl ? `<img class="avatar" src="${esc(siteUrl(avatarUrl))}" alt="" width="64" height="64" loading="lazy">` : `<span class="avatar avatar-txt" aria-hidden="true">${esc((h[0] ?? '?').toUpperCase())}</span>`}
        <div class="pid">
          <h1>@${esc(h)}</h1>
          ${a.display_name ? `<p class="dim">${esc(a.display_name)}</p>` : ''}
          ${a.bio ? `<p class="bio">${esc(a.bio)}</p>` : ''}
          <p class="dim">joined ${a.joined_at ? ago(a.joined_at) : '—'}${a.house ? ' · house' : ''}${a.demo ? ' · demo' : ''}</p>
        </div>
      </header>

      ${stats.length ? `<dl class="facts facts-row">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}

      ${links.length ? `<p class="links">${links.map(([label, url]) => url ? `<a class="btn btn-ghost" href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(label)} ↗</a>` : `<span class="btn btn-ghost">${esc(label)}</span>`).join(' ')}</p>` : ''}

      ${solutions.length
        ? `<h2>Entries <span class="count">${solutions.length}</span></h2><ul class="sols">${solList}</ul>`
        : `<p class="state">No entries yet.</p>`}
    </article>`;
}

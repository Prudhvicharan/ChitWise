'use strict';

/* =========================================================
   ChitWise — track chits (chit funds) month by month.
   All data lives in localStorage; export/import as JSON.
   ========================================================= */

const KEY = 'chitwise:v1';
const APP_VERSION = '1.0.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const sheet = $('#sheet');

/* ---------- Formatting ---------- */
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr = n => money.format(Math.round(n || 0));
const trim = v => v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
function short(n) {
  const neg = n < 0; n = Math.abs(n || 0);
  let s;
  if (n >= 1e7) s = trim(n / 1e7) + ' Cr';
  else if (n >= 1e5) s = trim(n / 1e5) + ' L';
  else if (n >= 1e3) s = trim(n / 1e3) + 'K';
  else s = String(Math.round(n));
  return (neg ? '−' : '') + '₹' + s;
}
const pct = r => (r * 100).toFixed(1).replace(/\.0$/, '') + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthOf(start, i) {
  const [y, m] = start.split('-').map(Number);
  const d = new Date(y, m - 1 + i, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}
const monthShort = (start, i) => { const { y, m } = monthOf(start, i); return `${MONTHS[m]} '${String(y).slice(2)}`; };
const monthLong = (start, i) => { const { y, m } = monthOf(start, i); return `${MONTHS_LONG[m]} ${y}`; };
function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function today() { const d = new Date(); return `${thisMonth()}-${String(d.getDate()).padStart(2, '0')}`; }
/** 1-based round number that falls in the current calendar month (may be <1 or >months). */
function currentRound(chit) {
  const [y, m] = chit.startMonth.split('-').map(Number);
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1)) + 1;
}
function fmtDate(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- Storage ---------- */
function normChit(c) {
  const pot = +c.pot || 0, members = Math.max(1, +c.members || 1);
  const months = Math.max(1, +c.months || members);
  return {
    id: c.id || uid(),
    name: String(c.name || 'Chit'),
    organizer: String(c.organizer || ''),
    pot, members, months,
    installment: +c.installment || Math.round(pot / members),
    startMonth: /^\d{4}-\d{2}$/.test(c.startMonth) ? c.startMonth : thisMonth(),
    dueDay: +c.dueDay || 10,
    commissionPct: +c.commissionPct || 0,
    winnerGetsDividend: c.winnerGetsDividend !== false,
    notes: String(c.notes || ''),
    createdAt: c.createdAt || Date.now(),
    rounds: (Array.isArray(c.rounds) ? c.rounds : [])
      .filter(r => r && +r.n >= 1 && +r.n <= months && ['auction', 'owner', 'lucky'].includes(r.type))
      .map(r => ({ ...r, n: +r.n }))
      .sort((a, b) => a.n - b.n),
  };
}
function normalize(d) {
  return {
    version: 1,
    chits: (d.chits || []).map(normChit),
    meta: { lastExport: null, lastChange: null, ...(d.meta || {}) },
  };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.chits)) return normalize(d);
    }
  } catch (e) { /* storage blocked or corrupt — fall through */ }
  return null;
}
function save() {
  state.meta.lastChange = Date.now();
  persist();
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — browser storage is blocked'); }
}
/** First launch: preload the chit the app was built for, so it's useful immediately. */
function seed() {
  return normalize({
    chits: [{
      name: '₹24L Chitti',
      organizer: '',
      pot: 2400000, members: 12, months: 12, installment: 200000,
      startMonth: '2026-08', dueDay: 10,
      notes: '12 members, 12 rounds. Thopudu split equally among all 12; winners still get thopudu.',
      rounds: [
        { n: 1, type: 'auction', winner: 'other', bid: 2148000, paid: true, estimate: true, note: 'Paid ~₹1,79,000 — not 100% sure.' },
        { n: 2, type: 'owner', winner: 'other', paid: true },
        { n: 3, type: 'auction', winner: 'other', bid: 1974000, paid: true },
      ],
    }],
    meta: {},
  });
}

let state = load();
if (!state) { state = seed(); persist(); }
const getChit = id => state.chits.find(c => c.id === id);

/* ---------- Chit math ----------
   pot          = total collected each month (members × installment)
   discount     = pot − winning bid               (what the winner gives up)
   commission   = pot × commission%               (organizer's cut, if any)
   thopudu      = (discount − commission) ÷ members   per member
   you pay      = installment − thopudu
*/
function compute(chit, hypo) {
  const M = chit.months, inst = chit.installment, mem = chit.members;
  const commission = chit.pot * (chit.commissionPct || 0) / 100;
  const byN = new Map(chit.rounds.map(r => [r.n, r]));
  if (hypo) byN.set(hypo.n, { n: hypo.n, type: 'auction', winner: 'me', bid: hypo.bid, hypo: true });
  const poolOf = r => r.type === 'auction' ? Math.max(0, chit.pot - (+r.bid || 0) - commission) : 0;

  const auctions = chit.rounds.filter(r => r.type === 'auction');
  const avgDiv = auctions.length ? sum(auctions, poolOf) / auctions.length / mem : 0;
  const realWin = chit.rounds.find(r => r.winner === 'me' && r.type !== 'owner');
  const iWillWin = hypo || realWin;
  const cur = currentRound(chit);

  const rows = [];
  let won = false;
  for (let n = 1; n <= M; n++) {
    const r = byN.get(n);
    const known = !!r;
    const done = known && !r.hypo;
    const poolDiv = known ? poolOf(r) / mem : (n === M ? 0 : avgDiv);
    const getsDiv = !won || chit.winnerGetsDividend;
    const div = getsDiv ? poolDiv : 0;
    const due = Math.round(inst - div);
    let mine = false, prize = 0, projectedWin = false;
    if (known && r.winner === 'me' && r.type !== 'owner') {
      mine = true;
      prize = num(r.received) ?? (r.type === 'auction' ? +r.bid : chit.pot);
    } else if (!known && !iWillWin && n === M) {
      // Never bid? Then you're the last one left and take the full pot.
      mine = true; projectedWin = true; prize = chit.pot;
    }
    rows.push({
      n, r, known, done, est: !done, type: known ? r.type : null,
      bid: known && r.type === 'auction' ? +r.bid : null,
      poolDiv, div, due, getsDiv,
      paid: done && !!r.paid,
      mine, prize, projectedWin, hypo: !!(r && r.hypo),
      isCurrent: n === cur, isPast: n < cur,
    });
    if (mine) won = true;
  }

  const recorded = rows.filter(x => x.done);
  const future = rows.filter(x => !x.done);
  const win = rows.find(x => x.mine) || null;
  const totalOut = sum(rows, x => x.due);
  const t = {
    rows, avgDiv, cur, commission,
    doneCount: recorded.length,
    paid: sum(recorded.filter(x => x.paid), x => x.due),
    unpaid: sum(recorded.filter(x => !x.paid), x => x.due),
    overdue: sum(recorded.filter(x => !x.paid && x.n < cur), x => x.due),
    dividends: sum(recorded, x => inst - x.due),
    remainingEst: sum(future, x => x.due),
    remainingMax: future.length * inst,
    totalOut,
    win,
    received: win && win.done ? win.prize : 0,
    completed: recorded.length >= M,
  };
  t.net = (win ? win.prize : 0) - totalOut;
  t.rate = irr(rows.flatMap(x => {
    const f = [{ t: x.n - 1, a: -x.due }];
    if (x.mine) f.push({ t: x.n - 1, a: x.prize });
    return f;
  }));
  return t;
}

/** Annualised internal rate of return for monthly cash flows. */
function irr(flows) {
  const npv = r => flows.reduce((s, f) => s + f.a / Math.pow(1 + r, f.t), 0);
  let lo = -0.5, hi = 1, flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (f * flo > 0) { lo = mid; flo = f; } else hi = mid;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
function rateText(t) {
  if (!t.win) return '';
  if (t.rate == null) return t.net >= 0 ? 'you get back more than you pay' : `you pay ${short(-t.net)} more than you get`;
  return t.net >= 0 ? `≈ ${pct(t.rate)} a year return` : `≈ ${pct(t.rate)} a year borrowing cost`;
}

/* ---------- Small UI helpers ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function openSheet(html, onMount) {
  sheet.innerHTML = html;
  if (!sheet.open) sheet.showModal();
  onMount && onMount(sheet);
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', e => {
  if (e.target === sheet) closeSheet(); // tap on backdrop
  if (e.target.closest('[data-close]')) closeSheet();
});

const TYPE_LABEL = { auction: 'Auction', owner: "Organizer's", lucky: 'Lucky dip' };
const typeChip = type => type ? `<span class="chip ${type}">${TYPE_LABEL[type]}</span>` : '';

const coinsArt = `<svg class="coins" viewBox="0 0 150 150" aria-hidden="true">
  ${Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${75 + Math.cos(a) * 52}" cy="${75 + Math.sin(a) * 52}" r="5" fill="#ffd38a" opacity="${0.35 + (i % 3) * 0.2}"/>`;
  }).join('')}
  <circle cx="75" cy="75" r="30" fill="#e39a2d" opacity=".9"/>
  <circle cx="75" cy="75" r="22" fill="none" stroke="#ffe2ad" stroke-width="2" opacity=".7"/>
</svg>`;

/* ---------- Views ---------- */
function renderHome() {
  if (!state.chits.length) {
    app.innerHTML = `
      <div class="empty">
        <svg class="art" viewBox="0 0 150 150" aria-hidden="true">
          ${Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            return `<circle cx="${75 + Math.cos(a) * 52}" cy="${75 + Math.sin(a) * 52}" r="6" fill="var(--accent)" opacity="${0.3 + (i % 3) * 0.25}"/>`;
          }).join('')}
          <circle cx="75" cy="75" r="28" fill="var(--primary)"/>
        </svg>
        <h2>No chits yet</h2>
        <p class="muted">Add a chit to start tracking payments, thopudu and your payout.</p>
        <div class="btn-row" style="justify-content:center;max-width:360px;margin:16px auto 0">
          <button class="btn primary" data-action="new-chit">Add a chit</button>
          <a class="btn" href="#/backup">Import backup</a>
        </div>
      </div>`;
    return;
  }

  const all = state.chits.map(c => ({ c, t: compute(c) }));
  const paid = sum(all, x => x.t.paid);
  const dividends = sum(all, x => x.t.dividends);
  const received = sum(all, x => x.t.received);
  const remaining = sum(all, x => x.t.remainingEst + x.t.unpaid);
  const overdue = sum(all, x => x.t.overdue);
  const net = sum(all, x => x.t.net);
  const now = new Date();

  const dueItems = all
    .filter(({ c, t }) => t.cur >= 1 && t.cur <= c.months)
    .map(({ c, t }) => {
      const row = t.rows[t.cur - 1];
      let right;
      if (row.done && row.paid) right = `<div class="amt num">${inr(row.due)}</div><span class="chip good">Paid</span>`;
      else if (row.done) right = `<div class="amt num">${inr(row.due)}</div><button class="btn sm primary" data-action="mark-paid" data-id="${c.id}" data-n="${row.n}">Mark paid</button>`;
      else right = `<div class="amt num muted">~${inr(row.due)}</div><button class="btn sm" data-action="round" data-id="${c.id}" data-n="${row.n}">Record</button>`;
      return `<div class="due-item">
        <div class="meta">
          <div class="t">${esc(c.name)}</div>
          <div class="small muted">Round ${row.n} of ${c.months} · due by ${c.dueDay} ${MONTHS[now.getMonth()]}${row.done ? '' : ' · auction not recorded yet'}</div>
        </div>
        <div style="text-align:right;display:grid;gap:4px;justify-items:end">${right}</div>
      </div>`;
    });
  const monthDue = sum(all.filter(({ c, t }) => t.cur >= 1 && t.cur <= c.months), ({ t }) => {
    const row = t.rows[t.cur - 1];
    return row.paid ? 0 : row.due;
  });

  const lastExport = state.meta.lastExport || 0;
  const needsBackup = (state.meta.lastChange || 0) > lastExport && Date.now() - lastExport > 7 * 864e5;

  app.innerHTML = `
    <section class="hero">
      ${coinsArt}
      <div class="label">Saved in chits so far</div>
      <div class="amount num">${inr(paid)}</div>
      <div class="sub">Thopudu earned <b class="num">${inr(dividends)}</b></div>
      <div class="hero-row">
        <div><div class="k">Left to pay this month</div><div class="v num">${inr(monthDue)}</div></div>
        <div><div class="k">Payouts received</div><div class="v num">${inr(received)}</div></div>
      </div>
    </section>

    ${needsBackup ? `<div class="banner">
      <span>You have changes that aren't backed up.</span>
      <button class="btn sm accent" data-action="export-json">Back up</button>
    </div>` : ''}

    ${dueItems.length ? `<h2 class="section">This month <small>${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()}</small></h2>
      <div class="card">${dueItems.join('')}</div>` : ''}

    <div class="stats">
      <div class="stat"><div class="k">Still to pay (est.)</div><div class="v num">${short(remaining)}</div><div class="h">across all chits</div></div>
      <div class="stat ${net >= 0 ? 'good' : 'bad'}"><div class="k">Net gain at the end (est.)</div><div class="v num">${short(net)}</div><div class="h">payouts − everything paid</div></div>
      ${overdue ? `<div class="stat bad"><div class="k">Overdue</div><div class="v num">${inr(overdue)}</div><div class="h">past months not marked paid</div></div>` : ''}
    </div>

    <h2 class="section">Your chits <small>${state.chits.length}</small></h2>
    ${all.map(({ c, t }) => chitCard(c, t)).join('')}
  `;
}

function chitCard(c, t) {
  const end = monthShort(c.startMonth, c.months - 1);
  const dots = t.rows.map(x => {
    const cls = ['dot'];
    if (x.done) cls.push(x.paid ? 'paid' : 'unpaid');
    if (x.isCurrent) cls.push('now');
    if (x.mine) cls.push(x.projectedWin ? 'mine projected' : 'mine');
    return `<span class="${cls.join(' ')}" title="${monthShort(c.startMonth, x.n - 1)}"></span>`;
  }).join('');
  let status;
  if (t.win && !t.win.projectedWin) status = `<span>🏆 You took it in ${monthShort(c.startMonth, t.win.n - 1)} · ${short(t.win.prize)}</span>`;
  else if (t.completed) status = `<span>Completed</span>`;
  else status = `<span>Not taken yet</span>`;
  return `<a class="card chit-card" href="#/chit/${c.id}">
    <div class="top">
      <div style="min-width:0">
        <h3>${esc(c.name)}</h3>
        <div class="small muted">${c.members} members · ${monthShort(c.startMonth, 0)} → ${end}</div>
      </div>
      <div class="pot num">${short(c.pot)}</div>
    </div>
    <div class="dots">${dots}</div>
    <div class="foot"><span>${t.completed ? 'All' : 'Round'} ${t.doneCount} of ${c.months} done · paid ${short(t.paid)}</span>${status}</div>
  </a>`;
}

function renderChit(id) {
  const c = getChit(id);
  if (!c) { location.hash = '#/'; return; }
  const t = compute(c);
  const won = t.win && !t.win.projectedWin;
  const payoutLabel = won ? 'Payout received' : 'Payout if you wait';
  const payoutHint = won
    ? `in ${monthLong(c.startMonth, t.win.n - 1)}`
    : `full pot in ${monthShort(c.startMonth, c.months - 1)}`;

  app.innerHTML = `
    <a class="back" href="#/">‹ All chits</a>
    <div class="detail-head">
      <div style="min-width:0">
        <h1>${esc(c.name)}</h1>
        <div class="muted small">${c.organizer ? esc(c.organizer) + ' · ' : ''}${short(c.pot)} pot · ${c.members} members · ${inr(c.installment)}/month${c.commissionPct ? ` · ${c.commissionPct}% commission` : ''}</div>
      </div>
      <button class="btn sm" data-action="edit-chit" data-id="${c.id}">Edit</button>
    </div>

    <div class="stats three">
      <div class="stat"><div class="k">Paid so far</div><div class="v num">${inr(t.paid)}</div><div class="h">${t.doneCount} of ${c.months} rounds${t.unpaid ? ` · ${inr(t.unpaid)} unpaid` : ''}</div></div>
      <div class="stat accent"><div class="k">Thopudu earned</div><div class="v num">${inr(t.dividends)}</div><div class="h">avg ${inr(t.avgDiv)} per auction</div></div>
      <div class="stat"><div class="k">Still to pay</div><div class="v num">~${inr(t.remainingEst)}</div><div class="h">max ${inr(t.remainingMax)} if no thopudu</div></div>
      <div class="stat"><div class="k">${payoutLabel}</div><div class="v num">${t.win ? inr(t.win.prize) : '—'}</div><div class="h">${t.win ? payoutHint : ''}</div></div>
      <div class="stat ${t.net >= 0 ? 'good' : 'bad'}"><div class="k">Net gain (est.)</div><div class="v num">${inr(t.net)}</div><div class="h">${rateText(t) || 'payout − total paid'}</div></div>
      <div class="stat"><div class="k">Total you'll pay (est.)</div><div class="v num">${inr(t.totalOut)}</div><div class="h">vs ${inr(c.installment * c.months)} without thopudu</div></div>
    </div>

    <h2 class="section">Month by month <small>tap a month to update</small></h2>
    <div class="card" style="padding:6px 10px">
      <ul class="rounds">${t.rows.map(x => roundRow(c, x)).join('')}</ul>
    </div>

    ${!won && !t.completed ? whatIfCard(c, t) : ''}

    ${c.notes ? `<h2 class="section">Notes</h2><div class="card" style="white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
  `;
  if (!won && !t.completed) mountWhatIf(c, t);
}

function roundRow(c, x) {
  const { y, m } = monthOf(c.startMonth, x.n - 1);
  const cls = ['round'];
  if (!x.done) cls.push('future');
  if (x.isCurrent) cls.push('current');
  if (x.mine && x.done) cls.push('won');

  const chips = [`<b>Round ${x.n}</b>`, typeChip(x.type)];
  if (x.mine && x.done) chips.push('<span class="chip me">You took it</span>');
  if (x.mine && x.projectedWin) chips.push('<span class="chip est">Yours if you never bid</span>');
  if (x.r && x.r.estimate) chips.push('<span class="chip est">not sure</span>');

  let line2;
  const who = x.r && x.r.winnerName ? ` · ${esc(x.r.winnerName)}` : '';
  if (!x.known) line2 = x.n === c.months ? 'Last round — no auction, full pot' : `Expected thopudu ~${inr(x.poolDiv)}`;
  else if (x.type === 'auction') line2 = `Bid ${short(x.bid)}${who} · thopudu ${inr(x.poolDiv)}${x.getsDiv ? '' : ' (not for you)'}`;
  else if (x.type === 'owner') line2 = `Organizer takes the pot · no thopudu`;
  else line2 = `Full pot${who} · no thopudu`;
  if (x.mine && x.done) line2 = `You received ${inr(x.prize)} · ` + line2;

  let status;
  if (x.done && x.paid) status = '<span class="chip good">Paid</span>';
  else if (x.done) status = `<span class="chip bad">${x.isPast ? 'Overdue' : 'Due'}</span>`;
  else if (x.isCurrent) status = '<span class="chip lucky">This month</span>';
  else status = '<span class="chip est">estimate</span>';

  const inst = c.installment;
  const w = v => Math.max(0, Math.min(100, (v / inst) * 100)).toFixed(1);
  return `<li class="${cls.join(' ')}" data-action="round" data-id="${c.id}" data-n="${x.n}">
    <div class="when"><div class="m">${MONTHS[m]}</div><div class="y">${y}</div></div>
    <div class="mid">
      <div class="line1">${chips.join(' ')}</div>
      <div class="line2">${line2}</div>
    </div>
    <div class="right">
      <div class="pay num">${x.done ? '' : '~'}${inr(x.due)}</div>
      ${status}
      <div class="meter" title="You pay vs thopudu"><i style="width:${w(x.due)}%"></i><b style="width:${w(inst - x.due)}%"></b></div>
    </div>
  </li>`;
}

function whatIfCard(c, t) {
  const open = t.rows.filter(x => !x.known && x.n < c.months);
  if (!open.length) return '';
  const defBid = Math.round(c.pot - t.avgDiv * c.members - t.commission) || Math.round(c.pot * 0.85);
  return `<h2 class="section">What if I take it? <small>plan your bid</small></h2>
    <div class="card whatif">
      <div class="row">
        <label class="field" style="margin-top:0"><span>Month</span>
          <select id="wiMonth">${open.map(x => `<option value="${x.n}">${monthLong(c.startMonth, x.n - 1)} (R${x.n})</option>`).join('')}</select>
        </label>
        <label class="field" style="margin-top:0"><span>Bid (amount you take)</span>
          <input id="wiBid" type="number" inputmode="numeric" min="0" max="${c.pot}" step="1000" value="${defBid}">
        </label>
      </div>
      <div id="wiOut"></div>
      <p class="small muted" style="margin:10px 2px 0">Future months use your average thopudu so far (${inr(t.avgDiv)}) as an estimate.</p>
    </div>`;
}

function mountWhatIf(c, base) {
  const mSel = $('#wiMonth'), bIn = $('#wiBid'), out = $('#wiOut');
  if (!mSel) return;
  const update = () => {
    const n = +mSel.value, bid = num(bIn.value);
    if (bid == null || bid <= 0 || bid > c.pot) { out.innerHTML = `<div class="result small muted">Enter a bid between ₹1 and ${inr(c.pot)}.</div>`; return; }
    const t = compute(c, { n, bid });
    const thop = Math.max(0, c.pot - bid - t.commission) / c.members;
    out.innerHTML = `<div class="result">
        <div class="small muted">You'd receive in ${monthLong(c.startMonth, n - 1)}</div>
        <div class="big num">${inr(bid)}</div>
        <div class="small muted">Everyone (you too) gets ${inr(thop)} thopudu that month</div>
      </div>
      <div class="compare">
        <div><div class="k">Take it in R${n}</div><div class="v num">${inr(t.net)}</div><div class="small muted">net · pay ${short(t.totalOut)} total</div><div class="small muted">${rateText(t)}</div></div>
        <div><div class="k">Wait till the end</div><div class="v num">${inr(base.net)}</div><div class="small muted">net · get ${short(c.pot)} in ${monthShort(c.startMonth, c.months - 1)}</div><div class="small muted">${rateText(base)}</div></div>
      </div>`;
  };
  mSel.addEventListener('change', update);
  bIn.addEventListener('input', update);
  update();
}

/* ---------- Round editor ---------- */
function openRound(id, n) {
  const c = getChit(id);
  const t = compute(c);
  const r = c.rounds.find(z => z.n === n) || {};
  const otherWin = c.rounds.find(z => z.winner === 'me' && z.n !== n && z.type !== 'owner');
  const wonEarlier = c.rounds.some(z => z.winner === 'me' && z.n < n && z.type !== 'owner');
  const getsDiv = !wonEarlier || c.winnerGetsDividend;
  const inst = c.installment, mem = c.members, comm = t.commission;
  const isLast = n === c.months;
  const type = r.type || 'none';
  const winner = r.winner === 'me' ? 'me' : 'other';
  const defaultPaid = r.type ? !!r.paid : n < t.cur;

  const radio = (name, val, label, checked, disabled) =>
    `<label><input type="radio" name="${name}" value="${val}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${label}</span></label>`;

  openSheet(`<form id="roundForm" novalidate>
    <div class="grab"></div>
    <h3>Round ${n} · ${monthLong(c.startMonth, n - 1)}</h3>
    <div class="muted small">${esc(c.name)} · installment ${inr(inst)} · pot ${inr(c.pot)}</div>

    <div class="field"><span>What happened this month?</span>
      <div class="seg">
        ${radio('type', 'auction', 'Auction', type === 'auction')}
        ${radio('type', 'owner', "Organizer's", type === 'owner')}
        ${radio('type', 'lucky', isLast ? 'Full pot' : 'Lucky dip', type === 'lucky')}
        ${radio('type', 'none', 'Not yet', type === 'none')}
      </div>
      ${isLast ? '<div class="hint">Last round: whoever is left takes the full pot — pick “Full pot”.</div>' : ''}
    </div>

    <div class="field" data-show="auction lucky"><span>Who took the money?</span>
      <div class="seg">
        ${radio('winner', 'other', 'Someone else', winner === 'other')}
        ${radio('winner', 'me', 'Me 🎉', winner === 'me', !!otherWin)}
      </div>
      ${otherWin ? `<div class="hint">You already took this chit in round ${otherWin.n}.</div>` : ''}
    </div>

    <label class="field" data-show="auction lucky" data-hide-me><span>Their name (optional)</span>
      <input type="text" name="winnerName" value="${esc(r.winnerName)}" autocomplete="off">
    </label>

    <div class="grid2" data-show="auction">
      <label class="field"><span>Winning bid (₹ taken)</span>
        <input type="number" name="bid" inputmode="numeric" min="0" max="${c.pot}" value="${r.bid ?? ''}" placeholder="e.g. 1974000">
      </label>
      <label class="field"><span>You pay this month</span>
        <input type="number" name="pay" inputmode="numeric" min="0" ${getsDiv ? '' : 'disabled'} placeholder="e.g. 164500">
      </label>
    </div>
    <div class="hint small muted" data-show="auction" style="margin-top:6px">Know only one? Fill either — the other is worked out.</div>

    <div class="calc" data-show="auction owner lucky" id="calc"></div>

    <label class="field" data-show-me><span>Amount you actually received (optional)</span>
      <input type="number" name="received" inputmode="numeric" min="0" value="${r.received ?? ''}" placeholder="Leave blank to use the bid">
    </label>

    <div data-show="auction owner lucky">
      <label class="check"><input type="checkbox" name="paid" ${defaultPaid ? 'checked' : ''}> I've paid this month's amount</label>
      <label class="field"><span>Paid on (optional)</span><input type="date" name="paidOn" value="${esc(r.paidOn)}"></label>
      <label class="check"><input type="checkbox" name="estimate" ${r.estimate ? 'checked' : ''}> I'm not sure about these numbers</label>
    </div>

    <label class="field"><span>Note</span><textarea name="note" rows="2">${esc(r.note)}</textarea></label>

    <div class="sheet-actions">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`, () => {
    const f = $('#roundForm');
    const divFromBid = bid => getsDiv ? Math.max(0, c.pot - bid - comm) / mem : 0;
    const sync = () => {
      const ty = f.type.value;
      const me = f.winner.value === 'me' && (ty === 'auction' || ty === 'lucky');
      $$('[data-show]', f).forEach(el => el.classList.toggle('hidden', !el.dataset.show.split(' ').includes(ty)));
      $$('[data-show-me]', f).forEach(el => el.classList.toggle('hidden', !me));
      $$('[data-hide-me]', f).forEach(el => el.classList.toggle('hidden', me || !['auction', 'lucky'].includes(ty)));
      const bid = num(f.bid.value);
      let disc = 0, pay = inst;
      if (ty === 'auction' && bid != null) { disc = c.pot - bid; pay = inst - divFromBid(bid); }
      const thop = ty === 'auction' && bid != null ? Math.max(0, disc - comm) / mem : 0;
      $('#calc').innerHTML = `
        ${ty === 'auction' ? `<span>Discount (pot − bid)</span><b class="num">${bid == null ? '—' : inr(disc)}</b>` : ''}
        ${comm ? `<span>Organizer commission</span><b class="num">${inr(ty === 'auction' ? comm : 0)}</b>` : ''}
        <span>Thopudu per member</span><b class="num">${inr(thop)}${getsDiv ? '' : ' (not for you)'}</b>
        <span>You pay</span><b class="num">${inr(pay)}</b>
        ${me ? `<span>You receive</span><b class="num">${inr(num(f.received.value) ?? (ty === 'auction' ? (bid ?? 0) : c.pot))}</b>` : ''}`;
    };
    f.bid.addEventListener('input', () => {
      const bid = num(f.bid.value);
      f.pay.value = bid == null ? '' : Math.round(inst - divFromBid(bid));
      sync();
    });
    f.pay.addEventListener('input', () => {
      const pay = num(f.pay.value);
      f.bid.value = pay == null ? '' : Math.round(c.pot - comm - (inst - pay) * mem);
      sync();
    });
    f.paid.addEventListener('change', () => { if (f.paid.checked && !f.paidOn.value) f.paidOn.value = today(); });
    f.addEventListener('change', sync);
    f.received.addEventListener('input', sync);
    if (r.bid != null) f.pay.value = Math.round(inst - divFromBid(+r.bid));
    sync();

    f.addEventListener('submit', e => {
      e.preventDefault();
      const ty = f.type.value;
      const bid = num(f.bid.value);
      if (ty === 'auction' && (bid == null || bid <= 0 || bid > c.pot)) {
        toast(`Enter a winning bid up to ${inr(c.pot)}`);
        return;
      }
      c.rounds = c.rounds.filter(z => z.n !== n);
      if (ty !== 'none') {
        const me = f.winner.value === 'me' && ty !== 'owner';
        c.rounds.push({
          n, type: ty,
          winner: me ? 'me' : 'other',
          winnerName: me || ty === 'owner' ? '' : f.winnerName.value.trim(),
          bid: ty === 'auction' ? bid : null,
          received: me ? num(f.received.value) : null,
          paid: f.paid.checked,
          paidOn: f.paid.checked ? f.paidOn.value : '',
          estimate: f.estimate.checked,
          note: f.note.value.trim(),
        });
        c.rounds.sort((a, b) => a.n - b.n);
      } else if (f.note.value.trim()) {
        toast('Note not saved — round has no result yet');
      }
      save();
      closeSheet();
      rerender();
      toast(ty === 'none' ? `Round ${n} cleared` : `Round ${n} saved`);
    });
  });
}

/* ---------- Chit editor ---------- */
function openChitForm(id) {
  const c = id ? getChit(id) : null;
  const v = c || { name: '', organizer: '', pot: '', members: '', months: '', installment: '', startMonth: thisMonth(), dueDay: 10, commissionPct: 0, winnerGetsDividend: true, notes: '' };
  openSheet(`<form id="chitForm" novalidate>
    <div class="grab"></div>
    <h3>${c ? 'Edit chit' : 'New chit'}</h3>
    <div class="muted small">Every number here can be changed later.</div>

    <label class="field"><span>Name</span><input type="text" name="title" value="${esc(v.name)}" placeholder="e.g. Office chitti" required></label>
    <label class="field"><span>Organizer (optional)</span><input type="text" name="organizer" value="${esc(v.organizer)}"></label>
    <div class="grid2">
      <label class="field"><span>Total pot (₹)</span><input type="number" name="pot" inputmode="numeric" min="1" value="${v.pot}" placeholder="2400000"></label>
      <label class="field"><span>Members</span><input type="number" name="members" inputmode="numeric" min="2" value="${v.members}" placeholder="12"></label>
      <label class="field"><span>Months / rounds</span><input type="number" name="months" inputmode="numeric" min="1" max="240" value="${v.months}" placeholder="12"></label>
      <label class="field"><span>Monthly installment (₹)</span><input type="number" name="installment" inputmode="numeric" min="1" value="${v.installment}" placeholder="auto"></label>
      <label class="field"><span>Started in</span><input type="month" name="startMonth" value="${esc(v.startMonth)}" placeholder="YYYY-MM"></label>
      <label class="field"><span>Due day of month</span><input type="number" name="dueDay" inputmode="numeric" min="1" max="31" value="${v.dueDay}"></label>
    </div>
    <label class="field"><span>Organizer commission (% of pot, per auction)</span>
      <input type="number" name="commissionPct" inputmode="decimal" min="0" max="20" step="0.5" value="${v.commissionPct}">
      <div class="hint">Leave 0 if the full discount is split among members.</div>
    </label>
    <label class="check"><input type="checkbox" name="winnerGetsDividend" ${v.winnerGetsDividend ? 'checked' : ''}> I still get thopudu after I take the chit</label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(v.notes)}</textarea></label>

    <div class="sheet-actions">
      ${c ? '<button type="button" class="btn danger" id="delChit">Delete</button>' : ''}
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">${c ? 'Save' : 'Add chit'}</button>
    </div>
  </form>`, () => {
    const f = $('#chitForm');
    let instTouched = !!c && Math.round(c.pot / c.members) !== c.installment;
    const autoInst = () => {
      const pot = num(f.pot.value), mem = num(f.members.value);
      if (!instTouched && pot && mem) f.installment.value = Math.round(pot / mem);
      if (!c && mem && !f.months.dataset.touched) f.months.value = mem;
    };
    f.pot.addEventListener('input', autoInst);
    f.members.addEventListener('input', autoInst);
    f.installment.addEventListener('input', () => { instTouched = true; });
    f.months.addEventListener('input', () => { f.months.dataset.touched = '1'; });

    $('#delChit')?.addEventListener('click', () => {
      if (!confirm(`Delete “${c.name}” and all its rounds? This can't be undone (unless you have a backup).`)) return;
      state.chits = state.chits.filter(z => z.id !== c.id);
      save(); closeSheet(); location.hash = '#/'; rerender();
      toast('Chit deleted');
    });

    f.addEventListener('submit', e => {
      e.preventDefault();
      const d = {
        name: f.title.value.trim(), organizer: f.organizer.value.trim(),
        pot: num(f.pot.value), members: num(f.members.value), months: num(f.months.value),
        installment: num(f.installment.value), startMonth: f.startMonth.value.trim(),
        dueDay: num(f.dueDay.value) || 10, commissionPct: num(f.commissionPct.value) || 0,
        winnerGetsDividend: f.winnerGetsDividend.checked, notes: f.notes.value.trim(),
      };
      if (!d.name) return toast('Give the chit a name');
      if (!d.pot || d.pot <= 0) return toast('Enter the total pot');
      if (!d.members || d.members < 2) return toast('Members must be at least 2');
      if (!d.months || d.months < 1) return toast('Enter the number of months');
      if (!/^\d{4}-\d{2}$/.test(d.startMonth)) return toast('Start month should look like 2026-08');
      d.installment = d.installment || Math.round(d.pot / d.members);
      if (c) {
        const dropped = c.rounds.filter(r => r.n > d.months).length;
        if (dropped && !confirm(`${dropped} recorded round(s) beyond month ${d.months} will be removed. Continue?`)) return;
        Object.assign(c, normChit({ ...c, ...d }));
        save(); closeSheet(); rerender(); toast('Saved');
      } else {
        const nc = normChit(d);
        state.chits.push(nc);
        save(); closeSheet(); location.hash = `#/chit/${nc.id}`;
        toast('Chit added — tap a month to record it');
      }
    });
  });
}

/* ---------- Backup & settings ---------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (route.current === 'backup') rerender(); });

function backupBlob() {
  const data = { app: 'ChitWise', version: 1, exportedAt: new Date().toISOString(), chits: state.chits, meta: { lastChange: state.meta.lastChange } };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
const backupName = () => `chitwise-backup-${today()}.json`;
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function markExported() { state.meta.lastExport = Date.now(); persist(); }
function exportJSON() { download(backupBlob(), backupName()); markExported(); toast('Backup downloaded'); rerender(); }
async function shareJSON() {
  const file = new File([backupBlob()], backupName(), { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'ChitWise backup' });
    markExported(); rerender();
  } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed — use Download instead'); }
}
function exportCSV() {
  const head = ['Chit', 'Round', 'Month', 'Status', 'Type', 'Winner', 'Winning bid', 'Thopudu per member', 'You pay', 'Paid', 'Paid on', 'Received by you', 'Not sure', 'Note'];
  const lines = [head];
  for (const c of state.chits) {
    const t = compute(c);
    for (const x of t.rows) {
      const r = x.r || {};
      lines.push([c.name, x.n, monthLong(c.startMonth, x.n - 1), x.done ? 'recorded' : 'estimate',
        x.type ? TYPE_LABEL[x.type] : '', x.mine && x.done ? 'Me' : (r.winnerName || ''), x.bid ?? '',
        Math.round(x.poolDiv), x.due, x.done ? (x.paid ? 'yes' : 'no') : '', r.paidOn || '',
        x.mine && x.done ? x.prize : '', r.estimate ? 'yes' : '', r.note || '']);
    }
  }
  const csv = lines.map(l => l.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv' }), `chitwise-${today()}.csv`);
  toast('Spreadsheet downloaded');
}
function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.chits)) throw new Error('no chits');
    } catch (e) { toast("That file isn't a ChitWise backup"); return; }
    const incoming = data.chits.map(normChit);
    const when = data.exportedAt ? fmtDate(Date.parse(data.exportedAt)) : 'unknown date';
    openSheet(`<div class="inner">
      <div class="grab"></div>
      <h3>Import backup</h3>
      <p class="muted">${incoming.length} chit${incoming.length === 1 ? '' : 's'} · exported ${when}</p>
      <p class="small">${incoming.map(c => '• ' + esc(c.name)).join('<br>')}</p>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn primary" id="impReplace">Replace everything</button>
        <button class="btn" id="impMerge">Merge with current</button>
      </div>
      <p class="small muted">Merge adds new chits and updates ones with the same ID. Replace removes what's on this device first.</p>
      <button class="btn block" data-close style="margin-top:6px">Cancel</button>
    </div>`, () => {
      $('#impReplace').onclick = () => {
        state.chits = incoming; save(); state.meta.lastExport = Date.now(); persist();
        closeSheet(); location.hash = '#/'; rerender(); toast('Backup restored');
      };
      $('#impMerge').onclick = () => {
        for (const ic of incoming) {
          const i = state.chits.findIndex(c => c.id === ic.id);
          if (i >= 0) state.chits[i] = ic; else state.chits.push(ic);
        }
        save(); closeSheet(); location.hash = '#/'; rerender(); toast('Backup merged');
      };
    });
  };
  reader.readAsText(file);
}

function renderBackup() {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  app.innerHTML = `
    <h1 style="font-size:1.5rem;margin:8px 0 4px">Backup & settings</h1>
    <p class="muted" style="margin:0 0 14px">Your data stays on this device only. Export a backup to move it to another phone, browser or computer.</p>

    <div class="card">
      <div class="card-title"><h3>Backup</h3><span class="chip ${state.meta.lastExport ? 'good' : 'bad'}">Last: ${fmtDate(state.meta.lastExport)}</span></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" data-action="export-json">Download backup</button>
        ${canShare ? '<button class="btn" data-action="share-json">Share / save to…</button>' : ''}
        <button class="btn" data-action="import">Import backup</button>
      </div>
      <input type="file" id="importInput" accept="application/json,.json" class="hidden">
      <button class="btn block" data-action="export-csv" style="margin-top:10px">Export spreadsheet (.csv)</button>
      <p class="small muted" style="margin:10px 2px 0">Tip: save the backup file to Google Drive / iCloud / WhatsApp-to-self so you never lose it.</p>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;font-size:1rem">Install as an app</h3>
      ${standalone ? '<p class="muted small" style="margin:0">ChitWise is installed ✓ — it works offline.</p>'
        : installPrompt ? '<button class="btn primary block" data-action="install">Install ChitWise</button>'
        : ios ? '<p class="muted small" style="margin:0">In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>.</p>'
        : '<p class="muted small" style="margin:0">Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>.</p>'}
    </div>

    <div class="card explain">
      <h3 style="margin:0;font-size:1rem">How ChitWise calculates</h3>
      <h4>Each auction</h4>
      <p>The lowest bidder takes the money. What they give up is shared equally by everyone as thopudu.</p>
      <div class="formula">discount = pot − winning bid<br>thopudu = (discount − commission) ÷ members<br>you pay = installment − thopudu</div>
      <h4>Organizer's month & lucky dip</h4>
      <p>No auction discount, so everyone pays the full installment.</p>
      <h4>Future months</h4>
      <p>Estimated using your average thopudu so far. The last round has no auction — whoever is left gets the full pot. If you haven't taken a chit yet, ChitWise assumes you get the full pot in the last month.</p>
      <h4>Net gain & yearly rate</h4>
      <p>Net gain = payout − everything you pay. The yearly rate is the effective interest (IRR): a <i>return</i> if you take it late, a <i>borrowing cost</i> if you take it early.</p>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px;font-size:1rem">Danger zone</h3>
      <button class="btn danger block" data-action="wipe">Erase all data on this device</button>
    </div>
    <p class="small muted" style="text-align:center;margin-top:18px">ChitWise v${APP_VERSION}</p>
  `;
  $('#importInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importFile(file);
    e.target.value = '';
  });
}

/* ---------- Actions ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const n = +el.dataset.n;
  switch (action) {
    case 'new-chit': openChitForm(); break;
    case 'edit-chit': openChitForm(id); break;
    case 'round': openRound(id, n); break;
    case 'mark-paid': {
      const r = getChit(id).rounds.find(z => z.n === n);
      if (r) { r.paid = true; r.paidOn = r.paidOn || today(); save(); rerender(); toast('Marked as paid'); }
      break;
    }
    case 'export-json': exportJSON(); break;
    case 'share-json': shareJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'import': $('#importInput').click(); break;
    case 'install':
      installPrompt?.prompt();
      installPrompt?.userChoice.finally(() => { installPrompt = null; rerender(); });
      break;
    case 'wipe':
      if (confirm('Erase every chit on this device? Make sure you have a backup.')) {
        state = normalize({ chits: [], meta: {} }); persist(); location.hash = '#/'; rerender(); toast('All data erased');
      }
      break;
  }
});

/* ---------- Router ---------- */
function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  route.current = parts[0] || 'home';
  if (parts[0] === 'chit' && parts[1]) renderChit(parts[1]);
  else if (parts[0] === 'backup') renderBackup();
  else renderHome();
  $$('.tabbar [data-tab]').forEach(a => a.classList.toggle('active', a.dataset.tab === (route.current === 'backup' ? 'backup' : 'home')));
}
function rerender() { const y = scrollY; route(); scrollTo(0, y); }
window.addEventListener('hashchange', () => { closeSheet(); route(); scrollTo(0, 0); });
window.addEventListener('storage', e => { if (e.key === KEY) { state = load() || state; rerender(); } });
route();

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});

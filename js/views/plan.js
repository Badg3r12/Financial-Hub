// Insight screens: monthly review, plan & projections, subscriptions, spending trends, cash flow, data health, glance.
import * as S from '../store.js';
import { h, raw, money, money0, signed, pct, thisMonth, monthName, addMonths, shortDate, today, toCents, sum, MONTHS, daysBetween } from '../util.js';
import * as C from '../calc.js';
import * as I from '../insights.js';
import * as M from '../market.js';
import { lines, line, bars, rangeTabs, filterRange } from '../charts.js';
import { openSheet, closeSheet, toast, options, formData } from '../ui.js';
import { saveBackup } from '../backup.js';

const cls = (v) => (v == null ? '' : v < 0 ? 'bad' : 'good');
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const kpi = (title, value, sub, cl = '') => h`<div class="card kpi"><h3>${title}</h3><div class="big num ${cl}">${value}</div>${sub ? h`<div class="sub">${sub}</div>` : ''}</div>`;
const catName = (id) => C.cat(id)?.name || 'Uncategorized';

// ---------------- Monthly review ----------------
function review(m) {
  const def = new Date().getDate() <= 7 ? addMonths(thisMonth(), -1) : thisMonth();
  m = /^\d{4}-\d{2}$/.test(m || '') ? m : def;
  const r = I.monthReview(m), partial = m === thisMonth();
  const vsTyp = r.typical ? r.sm.spent - r.typical : null;
  return h`<div class="row between wrap"><h1>Monthly review</h1><div class="row"><a class="btn" href="#review/${addMonths(m, -1)}" aria-label="Previous month">‹</a><b style="min-width:130px;text-align:center">${monthName(m)}</b>${m < thisMonth() ? h`<a class="btn" href="#review/${addMonths(m, 1)}" aria-label="Next month">›</a>` : h`<span class="btn" style="opacity:.4">›</span>`}</div></div>
  ${partial ? h`<p class="notice">${monthName(m)} isn't over yet, so these are figures so far.</p>` : ''}
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kpi('Money in', money0(r.sm.income), 'paychecks and other income')}
    ${kpi('Spent', money0(r.out), h`${money0(r.sm.spent)} in the budget${r.sm.oneOff ? ` · ${money0(r.sm.oneOff)} one-off` : ''}`)}
    ${kpi('Saved', money0(r.saved), r.rate != null ? `${pct(r.rate, 0)} of what came in${r.k401in ? ` · plus ${money0(r.k401in)} into the 401(k)` : ''}` : 'Add income to see your savings rate', cls(r.saved))}
  </div>
  <div class="grid cols-2" style="margin-bottom:14px">
    <div class="card"><h3>Investments</h3>
      <div class="big num ${cls(r.port.change)}">${signed(r.port.change)}</div>
      <ul class="list" style="margin-top:8px"><li><span class="grow">Money you added</span><span class="num">${signed(r.deposits)}</span></li>
        <li><span class="grow">Market gain or loss</span><span class="num ${cls(r.port.market)}">${signed(r.port.market)}</span></li>
        <li><span class="grow">Brokerage + IRA at month end</span><span class="num">${money0(r.port.end)}</span></li></ul>
      ${r.port.missing ? h`<p class="small muted">${r.port.missing} holding${r.port.missing > 1 ? 's have' : ' has'} no price history for this month and ${r.port.missing > 1 ? 'are' : 'is'} left out.</p>` : ''}</div>
    <div class="card"><h3>Net worth</h3><div class="big num ${cls(r.nw.change)}">${signed(r.nw.change)}</div>
      <p class="small muted">${money0(r.nw.start)} → ${money0(r.nw.end)}, from the balance snapshots you've entered.</p>
      <h3 style="margin-top:12px">Compared with</h3>
      <ul class="list"><li><span class="grow">Last month's budget spending</span><span class="num">${money0(r.prevSpent)}</span></li>
        ${r.typical ? h`<li><span class="grow">Your typical month</span><span class="num">${money0(r.typical)} <span class="small ${vsTyp > 0 ? 'bad' : 'good'}">(${vsTyp > 0 ? '+' : ''}${money0(vsTyp)})</span></span></li>` : ''}</ul></div>
  </div>
  <div class="grid cols-2">
    <div class="card"><h3>Over budget</h3>${r.over.length ? h`<ul class="list">${r.over.map((x) => h`<li class="tap" data-go="#txns/${m}/${x.catId}"><span class="grow">${catName(x.catId)}</span><span class="num bad">+${money0(x.by)}</span></li>`)}</ul>` : h`<p class="good">Every category stayed within budget.</p>`}
      ${r.under.length ? h`<h3 style="margin-top:12px">Most room left</h3><ul class="list">${r.under.map((x) => h`<li><span class="grow">${catName(x.catId)}</span><span class="num good">${money0(x.by)} under</span></li>`)}</ul>` : ''}</div>
    <div class="card"><h3>Biggest purchases</h3>${r.biggest.length ? h`<ul class="list">${r.biggest.map((t) => h`<li><div class="grow ellipsis">${t.note || t.merchant || catName(t.catId)}<div class="small muted">${shortDate(t.date)} · ${catName(t.catId)}</div></div><span class="num">${money(t.amount)}</span></li>`)}</ul>` : h`<p class="muted">No spending recorded.</p>`}</div>
  </div>`;
}

// ---------------- Plan: savings rate, projections, Roth IRA, 401(k) ----------------
function plan() {
  const pp = I.planPrefs(), hist = I.savingsHistory(12), full = hist.filter((x) => x.income);
  const avgSaved = full.length ? Math.round(sum(full, (x) => x.saved + x.k401) / full.length) : 0;
  const avgRate = full.length ? sum(full, (x) => x.saved) / Math.max(1, sum(full, (x) => x.income)) : null;
  const nw = C.netWorth().total, monthly = avgSaved + (pp.extra || 0);
  const age = pp.birthYear ? +today().slice(0, 4) - pp.birthYear : null, years = age != null ? Math.max(5, pp.retireAge - age) : 30;
  const series = I.projectSeries(nw, monthly, pp.ret, years);
  const miles = [10000000, 25000000, 50000000, 100000000].filter((g) => g > nw).map((g) => ({ g, months: I.monthsTo(g, nw, monthly, pp.ret) }));
  const y = +today().slice(0, 4), roth = [I.rothStatus(y), ...(today() <= `${y}-04-15` ? [I.rothStatus(y - 1)] : [])];
  const k = I.k401Plan();
  const label = (p) => (age != null ? `age ${age + p.x}` : `year ${p.x}`);
  return h`<div class="row between wrap"><h1>Plan</h1><button id="pl-edit">Assumptions</button></div>
  <p class="small muted" style="margin-top:-8px">Growth assumes ${pct(pp.ret, 0)} a year after inflation, so amounts are in today's dollars.${age != null ? ` You're ${age}; retiring at ${pp.retireAge}.` : ' Add your birth year under Assumptions to see ages.'}</p>
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kpi('Savings rate', avgRate != null ? pct(avgRate, 0) : '—', full.length ? `average of ${full.length} month${full.length > 1 ? 's' : ''}, after spending` : 'Needs income and spending since July')}
    ${kpi('Saving each month', money0(avgSaved), 'cash left over + 401(k) (you and match)')}
    ${kpi(age != null ? `Net worth at ${pp.retireAge}` : `Net worth in ${years} years`, money0(series.at(-1).value), `from ${money0(nw)} today`)}
  </div>
  <div class="card" style="margin-bottom:14px"><div class="row between wrap"><h3 style="margin:0">Net worth projection</h3>
    <label class="row small" style="gap:8px;color:var(--text)">Extra a month <input id="pl-extra" type="range" min="0" max="200000" step="5000" value="${pp.extra || 0}" style="width:160px;padding:0"><b class="num" id="pl-extra-v">${money0(pp.extra || 0)}</b></label></div>
    ${lines([{ name: 'Projected', points: series.map((p) => ({ x: p.year, y: p.value })) }], { height: 170, label })}
    <div class="grid cols-3" style="margin-top:10px">${miles.map((x) => h`<div><div class="small muted">${money0(x.g)}</div><b>${x.months == null ? 'not on this path' : x.months < 12 ? `${x.months} months` : `${(x.months / 12).toFixed(1)} years`}</b>${x.months != null && age != null ? h`<span class="small muted"> · age ${age + Math.floor(x.months / 12)}</span>` : ''}</div>`)}</div></div>
  <div class="card" style="margin-bottom:14px"><h3>Savings rate by month</h3>
    ${bars(hist.map((x) => ({ label: monthName(x.m), short: MONTHS[+x.m.slice(5) - 1].slice(0, 3), value: x.saved })))}
    <p class="small muted">Money in minus everything spent (budget and one-offs). The 401(k) comes out before your paycheck, so it's added separately above.</p></div>
  <div class="grid cols-2">
    <div class="card"><h3>Roth IRA contributions</h3>${roth.map((r) => h`<div style="margin:10px 0">
      <div class="row between"><b>${r.y} tax year</b><span class="num">${money0(r.amount)} of ${money0(r.limit)}</span></div>
      <div class="bar" style="margin:6px 0"><i style="width:${Math.min(100, (r.amount / r.limit) * 100)}%"></i></div>
      <div class="small muted">${r.left ? `${money0(r.left)} left · deadline ${shortDate(r.deadline)}` : r.estimated && r.amount > r.limit ? 'Over the limit by this estimate' : 'Maxed out'}${r.estimated ? ' · estimated from buys in the Roth IRA' : ''}${r.estimated && r.amount > r.limit ? ' (buys include money already in the account, so set the real amount)' : ''} · <button class="link" data-roth="${r.y}" style="padding:0;min-height:0">Set amount</button></div></div>`)}
      <p class="small muted">Contributions for a year can be made until the April tax deadline the next year. Limits: ${Object.entries(I.ROTH_LIMITS).map(([yy, v]) => `${yy} ${money0(v)}`).join(', ')} (under 50).</p></div>
    <div class="card"><h3>Roth 401(k)</h3>
      <div class="big num">${money0(k.atRetirement)}</div><div class="sub small muted">projected ${k.age != null ? `at ${pp.retireAge}` : `in ${k.years} years`}, from ${money0(k.value)} (${k.asOf ? shortDate(k.asOf) : 'no statement yet'})</div>
      <ul class="list" style="margin-top:8px"><li><span class="grow">Per paycheck (you + match)</span><span class="num">${money(k.perPaycheck)}</span></li><li><span class="grow">Per year (${k.perYear} paychecks)</span><span class="num">${money0(k.yearly)}</span></li></ul>
      ${line(k.series.map((p) => ({ x: p.year, y: p.value })), { height: 120, label: (p) => (k.age != null ? `age ${k.age + p.x}` : `year ${p.x}`) })}</div>
  </div>`;
}
function mountPlan(root) {
  root.querySelector('#pl-edit').onclick = editPlan;
  const r = root.querySelector('#pl-extra'), v = root.querySelector('#pl-extra-v');
  r.oninput = () => { v.textContent = money0(+r.value); };
  r.onchange = async () => { await S.saveSetting('plan', { ...S.setting('plan', {}), extra: +r.value }); };
  root.querySelectorAll('[data-roth]').forEach((b) => b.onclick = () => {
    const yr = +b.dataset.roth, cur = S.setting('rothContrib', {});
    const v2 = prompt(`Total Roth IRA contributions for ${yr} (leave empty to estimate from buys):`, cur[yr] != null ? (cur[yr] / 100).toFixed(2) : '');
    if (v2 === null) return; const c = toCents(v2); const next = { ...cur }; if (c == null) delete next[yr]; else next[yr] = c;
    S.saveSetting('rothContrib', next);
  });
}
function editPlan() {
  const pp = I.planPrefs();
  openSheet(h`<div class="row between"><h2>Assumptions</h2><button class="link" data-close>Close</button></div><form class="form" id="pf">
    <div class="two"><label>Birth year<input name="birthYear" inputmode="numeric" value="${pp.birthYear || ''}" placeholder="e.g. 2003"></label><label>Retire at age<input name="retireAge" inputmode="numeric" value="${pp.retireAge}"></label></div>
    <label>Yearly return after inflation (%)<input name="ret" inputmode="decimal" value="${(pp.ret * 100).toFixed(1)}"></label>
    <p class="small muted" style="margin:0">A broad stock index has averaged roughly 6–7% a year above inflation over long periods. Use a lower figure to be cautious.</p>
    <div class="row between sheet-actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`, (root) => {
    root.querySelector('#pf').onsubmit = async (e) => {
      e.preventDefault(); const d = formData(e.target), by = parseInt(d.birthYear, 10), ra = parseInt(d.retireAge, 10), ret = parseFloat(d.ret) / 100;
      await S.saveSetting('plan', { ...S.setting('plan', {}), birthYear: by > 1920 && by < 2020 ? by : null, retireAge: ra > 30 && ra < 90 ? ra : 60, ret: ret > -0.05 && ret < 0.15 ? ret : 0.07 });
      closeSheet(); toast('Saved');
    };
  });
}

// ---------------- Subscriptions & recurring ----------------
function subscriptions() {
  const rs = I.recurring(), live = rs.filter((r) => !r.lapsed), lapsed = rs.filter((r) => r.lapsed);
  const raised = live.filter((r) => r.raised), fresh = live.filter((r) => r.isNew);
  const row = (r) => h`<li><div class="grow"><b class="ellipsis">${r.name}</b>${r.raised ? h` <span class="pill bad">+${money(r.raised)}</span>` : ''}${r.isNew ? h` <span class="pill warn">new</span>` : ''}
    <div class="small muted">${r.cadence} · ${catName(r.catId)} · ${r.lapsed ? `last ${shortDate(r.last)}` : `next about ${shortDate(r.next)}`}</div></div>
    <div style="text-align:right"><div class="num">${money(r.amount)}</div><div class="small muted num">${money0(r.annual)}/yr</div></div></li>`;
  return h`<h1>Subscriptions &amp; bills</h1>
  <div class="grid cols-3" style="margin-bottom:14px">${kpi('Recurring a year', money0(sum(live, (r) => r.annual)), `${live.length} charge${live.length === 1 ? '' : 's'} that repeat`)}
    ${kpi('A month', money0(sum(live, (r) => r.annual) / 12), 'on average')}
    ${kpi('Price increases', String(raised.length), raised.length ? raised.map((r) => r.name).join(', ') : 'none spotted', raised.length ? 'bad' : '')}</div>
  ${fresh.length ? h`<p class="notice warn">New recurring charge${fresh.length > 1 ? 's' : ''}: ${fresh.map((r) => r.name).join(', ')}.</p>` : ''}
  <div class="card" style="margin-bottom:14px">${live.length ? h`<ul class="list">${live.map(row)}</ul>` : h`<p class="empty">No repeating charges found yet. They show up after the same merchant (or the same note) appears 3 times at a regular interval.</p>`}</div>
  ${lapsed.length ? h`<div class="card"><h3>Stopped or paused</h3><ul class="list">${lapsed.map(row)}</ul></div>` : ''}
  <p class="small muted">Found by looking for the same merchant or note at a steady interval with a similar amount. Shared and reimbursed costs are left out.</p>`;
}

// ---------------- Spending trends ----------------
function trendsView() {
  const t = I.trends(12), shortM = (m) => MONTHS[+m.slice(5) - 1].slice(0, 3);
  const hasLY = t.lastYear.some(Boolean);
  const heat = (v, max) => (v && max ? `background:color-mix(in srgb, var(--accent) ${Math.round(12 + (v / max) * 70)}%, transparent)` : '');
  return h`<h1>Spending trends</h1>
  <div class="card" style="margin-bottom:14px"><h3>Budget spending by month</h3>
    ${lines([{ name: 'This year', points: t.months.map((m, i) => ({ x: m, y: t.totals[i] })) }, ...(hasLY ? [{ name: 'Year before', points: t.months.map((m, i) => ({ x: m, y: t.lastYear[i] })) }] : [])], { label: (p) => monthName(p.x), height: 160 })}
    ${hasLY ? '' : h`<p class="small muted">Year-over-year comparison appears once there is spending from the same months a year earlier.</p>`}</div>
  <div class="card scroll-x"><h3>By category (darker = more of that category's highest month)</h3>
    <table class="heat sticky-col"><thead><tr><th>Category</th>${t.months.map((m) => h`<th>${shortM(m)}</th>`)}<th>12 mo</th></tr></thead><tbody>
    ${t.rows.map((r) => h`<tr><td><a href="#txns/all/${r.c.id}">${r.c.name}</a></td>${r.by.map((v, i) => h`<td class="num" style="${heat(v, r.max)}" title="${monthName(t.months[i])}: ${money0(v)}${r.budget ? ` (budget ${money0(r.budget)})` : ''}">${v ? h`<span class="${r.budget && v > r.budget ? 'bad' : ''}">${Math.round(v / 100)}</span>` : ''}</td>`)}<td class="num"><b>${money0(r.total)}</b></td></tr>`)}
    </tbody></table><p class="small muted">Whole dollars. Red means over that month's budget. Shared, one-off and reimbursed spending are left out.</p></div>`;
}

// ---------------- Cash flow ----------------
function cashflowView() {
  const cf = I.cashflow(45), t = today();
  const first = new Date(t.slice(0, 7) + '-01T12:00'), start = new Date(first); start.setDate(1 - first.getDay());
  const cells = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d.toLocaleDateString('en-CA')); }
  const weeks = cells.slice(-7)[0] < I.addDays(t, 35) ? cells : cells.slice(0, 35);
  const evOn = (d) => cf.events.filter((e) => e.date === d);
  return h`<h1>Cash flow</h1>
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kpi(cf.acct ? `${cf.acct} now` : 'Checking', cf.start != null ? money0(cf.start) : '—', cf.asOf ? `last snapshot ${shortDate(cf.asOf)}` : 'Add a checking snapshot under Net worth')}
    ${kpi('Bills next 45 days', money0(Math.abs(sum(cf.events.filter((e) => e.kind === 'bill'), (e) => e.amount))), `${cf.events.filter((e) => e.kind === 'bill').length} expected`)}
    ${kpi('Lowest point', cf.low ? money0(cf.low.balance) : '—', cf.low ? `around ${shortDate(cf.low.date)}` : cf.start == null ? 'needs a checking balance' : 'no paydays or bills predicted yet', cf.low && cf.low.balance < 50000 ? 'warn' : '')}
  </div>
  <div class="card" style="margin-bottom:14px"><h3>${monthName(t.slice(0, 7))}</h3><div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h`<div class="hd">${d}</div>`)}
    ${weeks.map((d) => { const ev = evOn(d); return h`<div class="${d.slice(0, 7) !== t.slice(0, 7) ? 'out' : ''} ${d === t ? 'today' : ''}"><div class="d">${+d.slice(8)}</div>
      ${ev.map((e) => h`<span class="dot" style="background:${e.kind === 'pay' ? 'var(--good)' : 'var(--warn)'}"></span><span class="ev ${e.kind === 'pay' ? 'good' : ''}">${e.kind === 'pay' ? '+' : ''}${money0(Math.abs(e.amount))} ${e.name}</span>`)}</div>`; })}</div></div>
  <div class="card"><h3>Coming up</h3>${cf.events.length ? h`<ul class="list">${cf.events.map((e) => h`<li><div class="grow">${e.name}<div class="small muted">${shortDate(e.date)} · ${e.kind === 'pay' ? (e.toChecking ? 'paycheck, the part that goes to checking' : 'paycheck') : 'expected bill'}</div></div>
    <div style="text-align:right"><div class="num ${e.amount > 0 ? 'good' : ''}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</div>${e.balance != null ? h`<div class="small muted num">${money0(e.balance)}</div>` : ''}</div></li>`)}</ul>` : h`<p class="empty">Nothing predicted yet. Paydays come from your paycheck history; bills from repeating charges.</p>`}
    <p class="small muted">Estimated from your paycheck rhythm and repeating charges. Everyday spending isn't included, so keep a cushion above the lowest point.</p></div>`;
}

// ---------------- Data health ----------------
function healthView() {
  const hv = I.health(), sync = (() => { try { return JSON.parse(localStorage.getItem('lastSyncInfo') || 'null'); } catch { return null; } })();
  return h`<h1>Data health</h1>
  ${hv.issues.length ? h`<div class="card" style="margin-bottom:14px"><ul class="list">${hv.issues.map((x) => h`<li class="${x.href || x.action ? 'tap' : ''}" ${raw(x.href ? `data-go="${x.href}"` : x.action ? `data-act="${x.action}"` : '')}><span class="pill ${x.level}">${x.level === 'bad' ? 'Fix' : 'Check'}</span><div class="grow"><b>${x.title}</b><div class="small muted">${x.detail}</div></div></li>`)}</ul></div>`
    : h`<div class="notice good" style="margin-bottom:14px">Everything looks up to date.</div>`}
  <div class="card"><h3>Suggested merchant rules</h3>${hv.rules.length ? h`<p class="small muted">You've given these merchants the same category several times. A rule fills it in automatically on future imports.</p>
    <ul class="list">${hv.rules.map((r) => h`<li><div class="grow"><b>${r.pattern}</b><div class="small muted">${r.hits} of ${r.of} times as ${catName(r.catId)}</div></div><button data-addrule="${r.pattern}" data-cat="${r.catId}">Add rule</button></li>`)}</ul>`
    : h`<p class="muted small">No new suggestions. Rules are also created automatically when you categorize imported rows in the Inbox.</p>`}</div>`;
}
function mountHealth(root) {
  root.querySelectorAll('[data-act="backup"]').forEach((el) => el.onclick = () => saveBackup());
  root.querySelectorAll('[data-addrule]').forEach((b) => b.onclick = async () => {
    const doc = await S.put('rules', { pattern: b.dataset.addrule, catId: b.dataset.cat, work: false });
    toast(`Rule added for ${doc.pattern}`, { action: 'Undo', onAction: () => S.remove('rules', doc.id) });
  });
}

// ---------------- Glance: big numbers only ----------------
function glance() {
  const m = thisMonth(), sm = C.monthSummary(m), nw = C.netWorth(), tot = C.accountTotals();
  const port = Object.values(tot).reduce((a, x) => ({ value: a.value + x.value, day: a.day + x.day }), { value: 0, day: 0 });
  const alerts = I.budgetAlerts(), next = I.cashflow(14).events.find((e) => e.kind === 'bill');
  return h`<div class="glance"><h1>At a glance</h1><div class="grid cols-2">
    <a class="card plain" href="#networth"><h3>Net worth</h3><div class="big num">${money0(nw.total)}</div></a>
    <a class="card plain" href="#invest"><h3>Investments today</h3><div class="big num ${cls(port.day)}">${signed(port.day)}</div><div class="sub small muted num">${money0(port.value)} brokerage + IRA</div></a>
    <a class="card plain" href="#budget"><h3>Budget left · ${MONTHS[+m.slice(5) - 1]}</h3><div class="big num ${sm.budget - sm.spent < 0 ? 'bad' : ''}">${money0(sm.budget - sm.spent)}</div><div class="sub small muted">${money0(sm.spent)} of ${money0(sm.budget)}</div></a>
    <div class="card"><h3>Heads up</h3>${alerts[0] ? h`<p class="${alerts[0].level}" style="margin:0">${alerts[0].text} ${money0(alerts[0].amount)}</p>` : h`<p class="good" style="margin:0">Spending is on pace.</p>`}
      ${next ? h`<p class="small muted" style="margin:8px 0 0">Next bill: ${next.name} ${money(-next.amount)} around ${shortDate(next.date)}</p>` : ''}</div>
  </div><p class="small muted">Tip: in Safari, open this page and choose Share → Add to Home Screen for a quick-look shortcut.</p></div>`;
}

const goMount = (root) => root.querySelectorAll('[data-go]').forEach((el) => el.onclick = () => { location.hash = el.dataset.go; });
export const views = {
  review: { render: review, mount: goMount },
  plan: { render: plan, mount: mountPlan },
  subscriptions: { render: subscriptions },
  trends: { render: trendsView },
  cashflow: { render: cashflowView },
  health: { render: healthView, mount: (r) => { goMount(r); mountHealth(r); } },
  glance: { render: glance },
};

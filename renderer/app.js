/* TaskForge renderer – vanilla JS, no build step. */
'use strict';

// ============================================================ utils
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(method, ...args) {
  const r = await window.taskforge.call(method, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DAY = 86400000;
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const STATUS = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done' };
const STATUS_COLOR = { todo: '#8f8e86', in_progress: '#3987e5', review: '#9085e9', done: '#0ca30c' };
const PRIORITY = { low: ['Low', '', '▽'], medium: ['Medium', 'accent', '◇'], high: ['High', 'serious', '▲'], urgent: ['Urgent', 'critical', '⚑'] };
const CATEGORIES = ['general', 'development', 'design', 'event', 'event-followup', 'sponsorship', 'marketing', 'logistics', 'content', 'finance', 'research'];
const ROLE_LABEL = { chair: 'Chairperson', head: 'Head', member: 'Member' };

function hashIndex(str, n) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function avatar(u, size = '') {
  if (!u) return `<span class="avatar ${size}">?</span>`;
  if (u.githubAvatar) return `<span class="avatar ${size}"><img src="${esc(u.githubAvatar)}" alt=""></span>`;
  return `<span class="avatar ${size}" style="background:${PALETTE[hashIndex(u.id, PALETTE.length)]}">${esc(initials(u.name))}</span>`;
}

function person(u, size = 'sm') {
  return `<span class="person">${avatar(u, size)}<span>${esc(u?.name || 'Unassigned')}</span></span>`;
}

function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  const abs = Math.abs(diff);
  const fut = diff < 0;
  let s;
  if (abs < 60000) s = 'just now';
  else if (abs < 3600000) s = `${Math.round(abs / 60000)}m`;
  else if (abs < DAY) s = `${Math.round(abs / 3600000)}h`;
  else if (abs < 30 * DAY) s = `${Math.round(abs / DAY)}d`;
  else return new Date(iso).toLocaleDateString();
  if (s === 'just now') return s;
  return fut ? `in ${s}` : `${s} ago`;
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) +
    (withTime ? ` · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '');
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}

function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Minutes logged on a task (optionally by one user / since a time), including a running timer.
function minutesOn(task, { userId = null, since = 0 } = {}) {
  let m = 0;
  for (const l of task.timeLogs || []) {
    if (userId && l.userId !== userId) continue;
    if (Date.parse(l.end) < since) continue;
    m += l.minutes;
  }
  if (task.timer && (!userId || task.timer.userId === userId)) {
    m += (Date.now() - Math.max(Date.parse(task.timer.start), since)) / 60000;
  }
  return m;
}

function deadlineInfo(t) {
  if (t.status === 'done') return { label: 'Done', cls: 'good', icon: '✓' };
  if (!t.deadline) return null;
  const diff = Date.parse(t.deadline) - Date.now();
  if (diff < 0) return { label: `Overdue ${relTime(t.deadline).replace(' ago', '')}`, cls: 'critical', icon: '⚠' };
  if (diff < DAY) return { label: `Due in ${Math.max(1, Math.round(diff / 3600000))}h`, cls: 'serious', icon: '⏰' };
  if (diff < 3 * DAY) return { label: `Due in ${Math.round(diff / DAY)}d`, cls: 'warning', icon: '◷' };
  return { label: fmtDate(t.deadline, false), cls: '', icon: '📅' };
}

function isOverdue(t) {
  return t.status !== 'done' && t.deadline && Date.parse(t.deadline) < Date.now();
}

function sortTasks(list) {
  const pr = { urgent: 0, high: 1, medium: 2, low: 3 };
  return [...list].sort((a, b) => {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
    const da = a.deadline ? Date.parse(a.deadline) : Infinity;
    const db = b.deadline ? Date.parse(b.deadline) : Infinity;
    if (da !== db) return da - db;
    return pr[a.priority] - pr[b.priority];
  });
}

function toast(text, kind = '', action = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="grow">${esc(text)}</div>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn sm primary';
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.run(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 12000 : 4500);
}

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'success');
    return r;
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

// ============================================================ state
const S = {
  data: null,
  page: 'dashboard',
  memberId: null,
  drawerTaskId: null,
  notifOpen: false,
  tasks: { scope: 'mine', status: 'active', view: 'list', person: '', q: '' },
  cal: { y: new Date().getFullYear(), m: new Date().getMonth() },
  gh: {}, // userId -> { loading, data, error }
  myRepos: null,
};

const me = () => S.data.me;
const user = (id) => S.data.users.find((u) => u.id === id);
const team = (id) => S.data.teams.find((t) => t.id === id);
const task = (id) => S.data.tasks.find((t) => t.id === id);
const isManager = () => me().role !== 'member';
const canManageUser = (id) => S.data.managedUserIds.includes(id);
const canManageTask = (t) => me().role === 'chair' || t.assignedById === me().id ||
  (t.assigneeId !== me().id && me().role === 'head' && (team(t.teamId)?.headId === me().id || canManageUser(t.assigneeId)));
const canWorkTask = (t) => t.assigneeId === me().id || canManageTask(t);
const teamsIHead = () => S.data.teams.filter((t) => me().role === 'chair' || t.headId === me().id);

async function refresh() {
  const st = await api('status');
  if (!st.user) {
    S.data = null;
    return renderAuth(st.needsSetup);
  }
  S.data = await api('bootstrap');
  render();
  if (S.drawerTaskId) {
    const active = document.activeElement;
    const typing = active && $('#drawer-root').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (!typing) renderDrawer();
  }
}

// ============================================================ auth
function renderAuth(needsSetup) {
  $('#drawer-root').innerHTML = '';
  $('#modal-root').innerHTML = '';
  const brand = `<div class="brand"><div class="brand-logo">✓</div>TaskForge</div>`;
  $('#app').innerHTML = needsSetup ? `
    <div class="auth-wrap"><form class="auth-card" id="setup-form">
      ${brand}
      <h1>Set up your workspace</h1>
      <p class="sub">You'll be the <b>Chairperson</b> – you can create teams, appoint heads, add members and see everyone's work.</p>
      <div class="field"><label>Organisation / club name</label><input type="text" name="orgName" placeholder="e.g. ACM Student Chapter" required></div>
      <div class="row">
        <div class="field"><label>Your name</label><input type="text" name="name" required></div>
        <div class="field"><label>Username</label><input type="text" name="username" required></div>
      </div>
      <div class="field"><label>Email</label><input type="email" name="email"></div>
      <div class="field"><label>Password</label><input type="password" name="password" minlength="6" required></div>
      <div class="error-text" id="auth-err"></div>
      <button class="btn primary block" type="submit">Create workspace</button>
    </form></div>` : `
    <div class="auth-wrap"><form class="auth-card" id="login-form">
      ${brand}
      <h1>Welcome back</h1>
      <p class="sub">Sign in to see your tasks, your team and your progress.</p>
      <div class="field"><label>Username</label><input type="text" name="username" autofocus required></div>
      <div class="field"><label>Password</label><input type="password" name="password" required></div>
      <div class="error-text" id="auth-err"></div>
      <button class="btn primary block" type="submit">Sign in</button>
      <p class="sub small" style="margin:16px 0 0">No account? Ask your team head or chairperson to add you.</p>
    </form></div>`;

  const form = $('#setup-form') || $('#login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(needsSetup ? 'setup' : 'login', data);
      S.page = 'dashboard';
      await refresh();
    } catch (err) {
      $('#auth-err').textContent = err.message;
    }
  };
}

// ============================================================ shell
const NAV = () => {
  const items = [
    ['dashboard', '◉', 'Dashboard'],
    ['tasks', '☰', 'Tasks', S.data.tasks.filter((t) => t.assigneeId === me().id && t.status !== 'done').length],
    ['calendar', '▦', 'Calendar'],
  ];
  const manage = [];
  if (me().role === 'chair') manage.push(['org', '⌂', 'Organisation']);
  if (isManager()) manage.push(['team', '⚇', me().role === 'chair' ? 'All teams' : 'My team']);
  return { items, manage };
};

const PAGE_TITLES = {
  dashboard: ['Dashboard', 'Your overview'],
  tasks: ['Tasks', 'Track, update and time your work'],
  calendar: ['Calendar', 'Deadlines at a glance'],
  org: ['Organisation', 'Teams, heads and members'],
  team: ['Teams', 'See how everyone is doing'],
  member: ['Person', 'Progress and GitHub activity'],
  profile: ['My profile', 'Your progress and GitHub'],
  settings: ['Settings', 'Account and workspace'],
};

function render() {
  const { items, manage } = NAV();
  const unread = S.data.notifications.filter((n) => !n.read).length;
  const navBtn = ([id, ico, label, count]) => `
    <button class="nav-item ${S.page === id ? 'active' : ''}" data-action="nav" data-page="${id}">
      <span class="ico">${ico}</span>${label}${count ? `<span class="count">${count}</span>` : ''}
    </button>`;
  const [title, crumb] = S.page === 'member' && user(S.memberId)
    ? [user(S.memberId).name, `${ROLE_LABEL[user(S.memberId).role]}${team(user(S.memberId).teamId) ? ` · ${team(user(S.memberId).teamId).name}` : ''}`]
    : PAGE_TITLES[S.page];

  const scrollTop = $('.content')?.scrollTop || 0;
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-logo">✓</div><div>TaskForge<div class="org">${esc(S.data.orgName)}</div></div></div>
        ${items.map(navBtn).join('')}
        ${manage.length ? `<div class="nav-label">Manage</div>${manage.map(navBtn).join('')}` : ''}
        <div class="nav-label">You</div>
        ${navBtn(['profile', '☺', 'My profile'])}
        ${navBtn(['settings', '⚙', 'Settings'])}
        <div class="spacer"></div>
        <div class="me-chip" data-action="nav" data-page="profile">
          ${avatar(me())}
          <div class="who"><b>${esc(me().name)}</b><span class="role-badge role-${me().role}">${ROLE_LABEL[me().role]}</span></div>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div><h2>${esc(title)}</h2><div class="crumb">${esc(crumb)}</div></div>
          <div class="grow"></div>
          <button class="btn ghost" data-action="sync-all" data-tip="Sync all GitHub-linked tasks now">⟳ Sync GitHub</button>
          <button class="btn bell" data-action="toggle-notifs">🔔${unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : ''}</button>
          <button class="btn primary" data-action="new-task">+ New task</button>
        </div>
        <div class="content">${renderPage()}</div>
      </main>
    </div>
    ${S.notifOpen ? renderNotifPanel() : ''}`;
  $('.content').scrollTop = scrollTop;
  afterRender();
}

function renderPage() {
  switch (S.page) {
    case 'dashboard': return pageDashboard();
    case 'tasks': return pageTasks();
    case 'calendar': return pageCalendar();
    case 'org': return pageOrg();
    case 'team': return pageTeam();
    case 'member': return pageMember(S.memberId);
    case 'profile': return pageMember(me().id);
    case 'settings': return pageSettings();
    default: return '';
  }
}

function afterRender() {
  // Lazy-load GitHub panels.
  for (const el of $$('[data-gh-panel]')) loadGithubPanel(el.dataset.ghPanel);
  // Board drag & drop.
  for (const card of $$('.column .task-card[draggable=true]')) {
    card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.id));
  }
  for (const col of $$('.column')) {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const t = task(id);
      if (t && t.status !== col.dataset.status) run(() => api('updateTask', id, { status: col.dataset.status }));
    });
  }
  const search = $('#task-search');
  if (search && S.tasks._focusSearch) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
    S.tasks._focusSearch = false;
  }
}

// ============================================================ shared components
function progressBar(t, size = '') {
  const active = !!t.timer && t.status !== 'done';
  return `<div class="progress-wrap" data-tip="${t.progress}% complete · mode: ${t.progressMode}">
    <div class="progress ${size}"><div class="bar ${t.status === 'done' ? 'done' : ''} ${active ? 'active' : ''}" style="width:${t.progress}%"></div></div>
    <span class="pct">${t.status === 'done' ? '✓ ' : ''}${t.progress}%</span></div>`;
}

function prioChip(p) {
  const [label, cls, ico] = PRIORITY[p] || PRIORITY.medium;
  return `<span class="chip ${cls}">${ico} ${label}</span>`;
}

function deadlineChip(t) {
  const d = deadlineInfo(t);
  return d ? `<span class="chip ${d.cls}" data-tip="${t.deadline ? esc(fmtDate(t.deadline)) : ''}">${d.icon} ${esc(d.label)}</span>` : '';
}

function ghChip(t) {
  if (!t.github) return '';
  const icon = { issue: '◎', pr: '⑂', milestone: '⚑' }[t.github.type];
  const label = `${t.github.repo.split('/')[1]} #${t.github.number}`;
  const state = t.github.error ? '⚠ error' : t.github.state || 'syncing…';
  return `<span class="chip gh" data-tip="${esc(t.github.repo)} · ${esc(state)}">${icon} ${esc(label)} · ${esc(state)}</span>`;
}

function timerButton(t) {
  if (!canWorkTask(t) || t.status === 'done') return '';
  const mine = t.timer && t.timer.userId === me().id;
  return `<button class="btn sm ${mine ? 'timer-on' : ''}" data-action="toggle-timer" data-id="${t.id}">
    ${mine ? `■ <span data-clock="${t.timer.start}">${fmtClock(Date.now() - Date.parse(t.timer.start))}</span>` : '▶ Start timer'}</button>`;
}

function suggestDone(t) {
  if (t.status === 'done' || t.progress < 100 || !canWorkTask(t)) return '';
  return `<div class="suggest"><span>✨</span><span class="grow">Looks complete – all progress is in. Mark as done?</span>
    <button class="btn sm" data-action="set-status" data-id="${t.id}" data-status="done">Mark done</button></div>`;
}

function taskCard(t, { draggable = false } = {}) {
  const spent = minutesOn(t);
  const a = user(t.assigneeId);
  const sub = t.subtasks.length ? `<span>☑ ${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}</span><span class="sep">·</span>` : '';
  return `
  <div class="task-card prio-${t.priority} ${t.status === 'done' ? 'is-done' : ''}" data-action="open-task" data-id="${t.id}" ${draggable ? 'draggable="true"' : ''}>
    <div class="tc-top">${prioChip(t.priority)}${t.category !== 'general' ? `<span class="chip violet">${esc(t.category)}</span>` : ''}<span class="grow"></span>${deadlineChip(t)}</div>
    <h4>${esc(t.title)}</h4>
    <div class="tc-meta">${person(a)}<span class="sep">·</span>${sub}<span data-tip="Time logged">⏱ ${fmtDur(spent)}${t.estimateHours ? ` / ${t.estimateHours}h` : ''}</span></div>
    ${progressBar(t)}
    ${suggestDone(t)}
    <div class="tc-foot">${ghChip(t)}<span class="grow"></span>${timerButton(t)}</div>
  </div>`;
}

function compactRow(t) {
  const d = deadlineInfo(t);
  return `<div class="compact-row" data-action="open-task" data-id="${t.id}">
    <div><div class="t">${esc(t.title)}</div><div class="s">${esc(user(t.assigneeId)?.name || '')}${t.github ? ` · ${esc(t.github.repo)}#${t.github.number}` : ''}</div></div>
    ${progressBar(t)}
    <div style="text-align:right">${d ? `<span class="chip ${d.cls}">${d.icon} ${esc(d.label)}</span>` : '<span class="muted small">No deadline</span>'}</div>
  </div>`;
}

function empty(icon, text, action = '') {
  return `<div class="empty"><div class="big">${icon}</div>${esc(text)}${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;
}

// Single-series column chart with hover tooltips.
function barChart(points, fmt = (v) => v) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return `<div class="bars">${points.map((p) => `
      <div class="b ${p.value ? '' : 'zero'}" data-tip="${esc(p.label)}: ${esc(fmt(p.value))}"><i style="height:${(p.value / max) * 100}%"></i></div>`).join('')}
    </div>
    <div class="bars-x">${points.map((p, i) => `<span>${i % 2 === 0 ? esc(p.short) : ''}</span>`).join('')}</div>`;
}

function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    d.setHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}

function userStats(uid) {
  const mine = S.data.tasks.filter((t) => t.assigneeId === uid);
  const active = mine.filter((t) => t.status !== 'done');
  const week = startOfWeek();
  return {
    tasks: mine,
    active: active.length,
    done: mine.length - active.length,
    overdue: active.filter(isOverdue).length,
    doneThisWeek: mine.filter((t) => t.completedAt && Date.parse(t.completedAt) >= week).length,
    weekMin: mine.reduce((s, t) => s + minutesOn(t, { userId: uid, since: week }), 0),
    totalMin: S.data.tasks.reduce((s, t) => s + minutesOn(t, { userId: uid }), 0),
    avgProgress: active.length ? Math.round(active.reduce((s, t) => s + t.progress, 0) / active.length) : (mine.length ? 100 : 0),
  };
}

// ============================================================ dashboard
function pageDashboard() {
  const st = userStats(me().id);
  const mine = S.data.tasks.filter((t) => t.assigneeId === me().id);
  const active = sortTasks(mine.filter((t) => t.status !== 'done'));
  const dueSoon = active.filter((t) => t.deadline && Date.parse(t.deadline) - Date.now() < 3 * DAY);
  const suggestions = active.filter((t) => t.progress >= 100);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const due24 = active.filter((t) => t.deadline && Date.parse(t.deadline) - Date.now() < DAY && !isOverdue(t)).length;

  const upcoming = sortTasks(S.data.tasks.filter((t) => t.status !== 'done' && t.deadline && Date.parse(t.deadline) - Date.now() < 7 * DAY)).slice(0, 8);

  return `
    <div class="hero">
      <div class="grow">
        <h1>${greet}, ${esc(me().name.split(' ')[0])} 👋</h1>
        <p>You have <b>${st.active}</b> active task${st.active === 1 ? '' : 's'}${due24 ? `, <b>${due24}</b> due in the next 24 hours` : ''}${st.overdue ? ` and <b style="color:#ff8a8a">${st.overdue} overdue</b>` : ''}.</p>
      </div>
      <button class="btn primary" data-action="new-task">+ New task</button>
    </div>

    <div class="grid cols-4">
      ${statTile('Active tasks', st.active, `${st.overdue} overdue`, '☰')}
      ${statTile('Due this week', active.filter((t) => t.deadline && Date.parse(t.deadline) - Date.now() < 7 * DAY).length, 'including overdue', '📅')}
      ${statTile('Completed this week', st.doneThisWeek, `${st.done} completed all-time`, '✓')}
      ${statTile('Time this week', fmtDur(st.weekMin), `${fmtDur(st.totalMin)} all-time`, '⏱')}
    </div>

    ${isManager() ? managerOverview() : ''}

    <div class="grid main-side mt">
      <div class="stack">
        ${dueSoon.length || suggestions.length ? `
        <div class="card">
          <div class="card-head"><h3>⚠ Needs attention</h3><span class="sub">Overdue, due within 3 days, or ready to close</span></div>
          <div class="task-list">${[...new Set([...suggestions, ...dueSoon])].slice(0, 6).map((t) => taskCard(t)).join('')}</div>
        </div>` : ''}
        <div class="card">
          <div class="card-head"><h3>My active work</h3><button class="btn sm ghost" data-action="nav" data-page="tasks">View all →</button></div>
          <div class="compact-list">${active.length ? active.slice(0, 10).map(compactRow).join('') : empty('🎉', 'Nothing on your plate. Enjoy!')}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>Upcoming deadlines</h3><span class="sub">next 7 days</span></div>
          ${upcoming.length ? upcoming.map((t) => `
            <div class="feed-item" data-action="open-task" data-id="${t.id}" style="cursor:pointer">
              ${avatar(user(t.assigneeId), 'sm')}<div style="min-width:0"><div style="color:var(--text)">${esc(t.title)}</div><div class="small muted">${esc(user(t.assigneeId)?.name || '')} · ${t.progress}%</div></div>
              <span class="when">${deadlineChip(t)}</span>
            </div>`).join('') : empty('🗓', 'No deadlines this week')}
        </div>
        <div class="card">
          <div class="card-head"><h3>Recent activity</h3></div>
          ${S.data.activity.length ? S.data.activity.slice(0, 12).map((a) => `
            <div class="feed-item" ${a.taskId && task(a.taskId) ? `data-action="open-task" data-id="${a.taskId}" style="cursor:pointer"` : ''}>
              ${avatar(user(a.userId), 'sm')}<div>${esc(a.text)}</div><span class="when">${relTime(a.at)}</span>
            </div>`).join('') : empty('·', 'No activity yet')}
        </div>
      </div>
    </div>`;
}

function statTile(label, value, foot, ico) {
  return `<div class="card stat"><div class="label">${ico} ${esc(label)}</div><div class="value">${esc(value)}</div><div class="foot">${esc(foot)}</div></div>`;
}

function managerOverview() {
  const teams = teamsIHead();
  if (!teams.length) {
    return me().role === 'chair' ? `<div class="card mt">${empty('⚇', 'Create your first team and appoint a head to get started.', '<button class="btn primary" data-action="new-team">+ New team</button>')}</div>` : '';
  }
  const members = S.data.users.filter((u) => S.data.managedUserIds.includes(u.id) && u.id !== me().id);
  const week = startOfWeek();
  const hours = members.map((u) => ({ u, min: S.data.tasks.reduce((s, t) => s + minutesOn(t, { userId: u.id, since: week }), 0) }))
    .sort((a, b) => b.min - a.min).slice(0, 8);
  const maxMin = Math.max(1, ...hours.map((h) => h.min));
  return `
    <div class="grid cols-2 mt">
      <div class="card">
        <div class="card-head"><h3>${me().role === 'chair' ? 'Teams overview' : 'My team'}</h3><button class="btn sm ghost" data-action="nav" data-page="team">Details →</button></div>
        ${teams.map((tm) => {
          const tt = S.data.tasks.filter((t) => t.teamId === tm.id);
          const done = tt.filter((t) => t.status === 'done').length;
          const pct = tt.length ? Math.round((done / tt.length) * 100) : 0;
          const od = tt.filter(isOverdue).length;
          return `<div style="padding:9px 0">
            <div class="flex small" style="margin-bottom:6px"><span class="team-dot" style="background:${tm.color}"></span><b>${esc(tm.name)}</b>
              <span class="muted">· ${esc(user(tm.headId)?.name || 'no head')}</span><span class="grow"></span>
              ${od ? `<span class="chip critical">⚠ ${od} overdue</span>` : ''}<span class="muted">${done}/${tt.length} done</span></div>
            <div class="progress-wrap" data-tip="${esc(tm.name)}: ${pct}% of tasks done"><div class="progress"><div class="bar" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-head"><h3>Hours logged this week</h3><span class="sub">by person</span></div>
        ${hours.length ? hours.map(({ u, min }) => `
          <div class="hbar-row" data-action="open-member" data-id="${u.id}" style="cursor:pointer" data-tip="${esc(u.name)}: ${fmtDur(min)}">
            ${person(u)}<div class="track"><div class="fill" style="width:${(min / maxMin) * 100}%"></div></div><span class="v">${fmtDur(min)}</span>
          </div>`).join('') : empty('⏱', 'No team members yet')}
      </div>
    </div>`;
}

// ============================================================ tasks page
function scopedTasks() {
  const f = S.tasks;
  let list = S.data.tasks;
  if (f.scope === 'mine') list = list.filter((t) => t.assigneeId === me().id);
  else if (f.scope === 'assigned') list = list.filter((t) => t.assignedById === me().id && t.assigneeId !== me().id);
  else if (f.scope === 'team') list = list.filter((t) => t.assigneeId !== me().id);
  if (f.person) list = list.filter((t) => t.assigneeId === f.person);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((t) => `${t.title} ${t.description} ${t.tags.join(' ')} ${t.github?.repo || ''} ${user(t.assigneeId)?.name || ''}`.toLowerCase().includes(q));
  }
  return list;
}

function pageTasks() {
  const f = S.tasks;
  const base = scopedTasks();
  const byStatus = {
    active: base.filter((t) => t.status !== 'done'),
    todo: base.filter((t) => t.status === 'todo'),
    in_progress: base.filter((t) => t.status === 'in_progress'),
    review: base.filter((t) => t.status === 'review'),
    done: base.filter((t) => t.status === 'done'),
    overdue: base.filter(isOverdue),
    all: base,
  };
  const scopes = [['mine', 'Assigned to me']];
  if (isManager() || S.data.tasks.some((t) => t.assignedById === me().id && t.assigneeId !== me().id)) scopes.push(['assigned', 'Assigned by me']);
  if (isManager()) scopes.push(['team', me().role === 'chair' ? 'Everyone else' : 'My team']);
  const people = S.data.users.filter((u) => canManageUser(u.id));
  const list = sortTasks(byStatus[f.status] || base);

  let body;
  if (f.view === 'board') {
    body = `<div class="board">${Object.keys(STATUS).map((s) => {
      const col = sortTasks(base.filter((t) => t.status === s));
      return `<div class="column" data-status="${s}">
        <div class="column-head"><span class="dot" style="background:${STATUS_COLOR[s]}"></span>${STATUS[s]}<span class="n">${col.length}</span></div>
        ${col.map((t) => taskCard(t, { draggable: canWorkTask(t) })).join('') || '<div class="empty small">Drop tasks here</div>'}
      </div>`;
    }).join('')}</div>`;
  } else {
    body = list.length ? `<div class="task-list">${list.map((t) => taskCard(t)).join('')}</div>`
      : empty('🗂', f.q ? 'No tasks match your search.' : 'No tasks here yet.', '<button class="btn primary" data-action="new-task">+ New task</button>');
  }

  return `
    <div class="toolbar">
      <div class="seg">${scopes.map(([k, l]) => `<button class="${f.scope === k ? 'on' : ''}" data-action="task-scope" data-v="${k}">${l}</button>`).join('')}</div>
      ${f.scope !== 'mine' && people.length > 1 ? `<select data-change="task-person"><option value="">Everyone</option>${people.map((u) => `<option value="${u.id}" ${f.person === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      <input type="search" id="task-search" placeholder="Search tasks, repos, people…" value="${esc(f.q)}" style="width:240px">
      <span style="flex:1"></span>
      <div class="seg">
        <button class="${f.view === 'list' ? 'on' : ''}" data-action="task-view" data-v="list">▤ Cards</button>
        <button class="${f.view === 'board' ? 'on' : ''}" data-action="task-view" data-v="board">▥ Board</button>
      </div>
    </div>
    ${f.view === 'list' ? `<div class="toolbar"><div class="seg">${[['active', 'Active'], ['todo', 'To do'], ['in_progress', 'In progress'], ['review', 'Review'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']]
      .map(([k, l]) => `<button class="${f.status === k ? 'on' : ''}" data-action="task-status" data-v="${k}">${l}<span class="n">${byStatus[k].length}</span></button>`).join('')}</div></div>` : ''}
    ${body}`;
}

// ============================================================ calendar
function pageCalendar() {
  const { y, m } = S.cal;
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const today = new Date().toDateString();
  const byDay = {};
  for (const t of S.data.tasks) {
    if (!t.deadline) continue;
    const k = new Date(t.deadline).toDateString();
    (byDay[k] ||= []).push(t);
  }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const items = sortTasks(byDay[d.toDateString()] || []);
    cells.push(`<div class="day ${d.getMonth() !== m ? 'other' : ''} ${d.toDateString() === today ? 'today' : ''}">
      <div class="n">${d.getDate()}</div>
      ${items.slice(0, 4).map((t) => `<div class="ev ${t.status === 'done' ? 'done' : ''} ${isOverdue(t) ? 'overdue' : ''}" data-action="open-task" data-id="${t.id}"
          data-tip="${esc(t.title)} · ${esc(user(t.assigneeId)?.name || '')} · ${t.progress}%">${esc(t.title)}</div>`).join('')}
      ${items.length > 4 ? `<div class="small muted">+${items.length - 4} more</div>` : ''}
    </div>`);
  }
  return `
    <div class="toolbar">
      <button class="btn" data-action="cal-move" data-v="-1">‹</button>
      <h3 style="min-width:180px;text-align:center">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
      <button class="btn" data-action="cal-move" data-v="1">›</button>
      <button class="btn ghost" data-action="cal-move" data-v="0">Today</button>
      <span style="flex:1"></span>
      <span class="chip critical">⚠ overdue</span><span class="chip good">✓ done</span><span class="chip accent">◷ upcoming</span>
    </div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`;
}

// ============================================================ team page
function memberRows(users) {
  return `<div class="member-row header"><span>Person</span><span>Active</span><span>Done</span><span>Overdue</span><span>Hours (wk)</span><span>Avg progress</span></div>` +
    users.map((u) => {
      const st = userStats(u.id);
      return `<div class="member-row" data-action="open-member" data-id="${u.id}">
        <div class="person">${avatar(u)}<div class="who"><b>${esc(u.name)} <span class="role-badge role-${u.role}">${ROLE_LABEL[u.role]}</span></b><small>${esc(u.title || (u.githubLogin ? '@' + u.githubLogin : u.username))}</small></div></div>
        <span class="num">${st.active}</span><span class="num">${st.done}</span><span class="num ${st.overdue ? 'warn' : ''}">${st.overdue}</span>
        <span class="num">${fmtDur(st.weekMin)}</span>
        <div class="progress-wrap" data-tip="Average progress of active tasks"><div class="progress"><div class="bar" style="width:${st.avgProgress}%"></div></div><span class="pct">${st.avgProgress}%</span></div>
      </div>`;
    }).join('');
}

function pageTeam() {
  const teams = teamsIHead();
  if (!teams.length) return empty('⚇', me().role === 'chair' ? 'No teams yet.' : 'You are not heading any team yet.', me().role === 'chair' ? '<button class="btn primary" data-action="new-team">+ New team</button>' : '');
  const sections = teams.map((tm) => {
    const members = S.data.users.filter((u) => u.teamId === tm.id || u.id === tm.headId)
      .sort((a, b) => (a.id === tm.headId ? -1 : b.id === tm.headId ? 1 : a.name.localeCompare(b.name)));
    const tt = S.data.tasks.filter((t) => t.teamId === tm.id);
    const done = tt.filter((t) => t.status === 'done').length;
    return `<div class="card team-card">
      <div class="team-head">
        <span class="team-dot" style="background:${tm.color}"></span>
        <div class="grow"><h3>${esc(tm.name)}</h3><div class="small muted">Head: ${esc(user(tm.headId)?.name || '—')} · ${members.length} people · ${done}/${tt.length} tasks done</div></div>
        <button class="btn sm" data-action="new-task" data-team="${tm.id}">+ Assign task</button>
        <button class="btn sm" data-action="new-person" data-team="${tm.id}">+ Add member</button>
      </div>
      ${members.length ? memberRows(members) : empty('👥', 'No members yet')}
    </div>`;
  });
  const unassigned = me().role === 'chair' ? S.data.users.filter((u) => !u.teamId && u.role !== 'chair') : [];
  return `<div class="stack">${sections.join('')}
    ${unassigned.length ? `<div class="card team-card"><div class="team-head"><span class="team-dot" style="background:#55554f"></span><div class="grow"><h3>Not in a team</h3></div></div>${memberRows(unassigned)}</div>` : ''}
  </div>`;
}

// ============================================================ org page (chair)
function pageOrg() {
  const tasks = S.data.tasks;
  const done = tasks.filter((t) => t.status === 'done').length;
  const week = startOfWeek();
  const weekMin = tasks.reduce((s, t) => s + minutesOn(t, { since: week }), 0);
  return `
    <div class="grid cols-4">
      ${statTile('People', S.data.users.length, `${S.data.users.filter((u) => u.role === 'head').length} heads`, '👥')}
      ${statTile('Teams', S.data.teams.length, '', '⚇')}
      ${statTile('Completion', tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : '—', `${done}/${tasks.length} tasks done`, '✓')}
      ${statTile('Hours this week', fmtDur(weekMin), `${tasks.filter(isOverdue).length} tasks overdue`, '⏱')}
    </div>
    <div class="card mt">
      <div class="card-head"><h3>Teams</h3><button class="btn sm primary" data-action="new-team">+ New team</button></div>
      ${S.data.teams.length ? `<div class="grid cols-2">${S.data.teams.map((tm) => {
        const tt = tasks.filter((t) => t.teamId === tm.id);
        const d = tt.filter((t) => t.status === 'done').length;
        const pct = tt.length ? Math.round((d / tt.length) * 100) : 0;
        const n = S.data.users.filter((u) => u.teamId === tm.id).length;
        return `<div class="card" style="background:var(--surface-2)">
          <div class="flex"><span class="team-dot" style="background:${tm.color}"></span><h3 class="grow">${esc(tm.name)}</h3>
            <button class="btn sm ghost" data-action="edit-team" data-id="${tm.id}">Edit</button></div>
          <div class="small muted" style="margin:6px 0 12px">${esc(tm.description || 'No description')}</div>
          <div class="flex small" style="margin-bottom:10px">${person(user(tm.headId))}<span class="grow"></span><span class="muted">${n} people · ${tt.filter(isOverdue).length} overdue</span></div>
          <div class="progress-wrap" data-tip="${d}/${tt.length} tasks done"><div class="progress"><div class="bar" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></div>
        </div>`;
      }).join('')}</div>` : empty('⚇', 'No teams yet')}
    </div>
    <div class="card mt">
      <div class="card-head"><h3>People</h3><button class="btn sm primary" data-action="new-person">+ Add person</button></div>
      <table class="people"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Team</th><th>GitHub</th><th>Active</th><th></th></tr></thead><tbody>
      ${S.data.users.map((u) => `<tr>
        <td><a href="#" data-action="open-member" data-id="${u.id}">${person(u)}</a></td>
        <td class="muted">${esc(u.username)}</td>
        <td><span class="role-badge role-${u.role}">${ROLE_LABEL[u.role]}</span></td>
        <td>${team(u.teamId) ? `<span class="flex"><span class="team-dot" style="background:${team(u.teamId).color}"></span>${esc(team(u.teamId).name)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${u.githubLogin ? `<span class="chip gh">@${esc(u.githubLogin)}${u.githubConnected ? ' ✓' : ''}</span>` : '<span class="muted">—</span>'}</td>
        <td>${userStats(u.id).active}</td>
        <td style="text-align:right">${u.id !== me().id ? `<button class="btn sm ghost" data-action="edit-person" data-id="${u.id}">Edit</button>` : ''}</td>
      </tr>`).join('')}
      </tbody></table>
    </div>`;
}

// ============================================================ member / profile page
function pageMember(uid) {
  const u = user(uid);
  if (!u) return empty('?', 'Person not found');
  const isMe = uid === me().id;
  const st = userStats(uid);
  const days = lastNDays(14);
  const perDay = days.map((d) => {
    const s = d.getTime();
    const e = s + DAY;
    let min = 0;
    for (const t of S.data.tasks) {
      for (const l of t.timeLogs) if (l.userId === uid && Date.parse(l.end) >= s && Date.parse(l.end) < e) min += l.minutes;
      if (t.timer?.userId === uid && e > Date.now() && s <= Date.now()) min += (Date.now() - Math.max(Date.parse(t.timer.start), s)) / 60000;
    }
    return { label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), short: d.toLocaleDateString(undefined, { day: 'numeric' }), value: Math.round(min) };
  });
  const tasks = sortTasks(st.tasks);
  const byCat = {};
  for (const t of S.data.tasks) {
    const m = minutesOn(t, { userId: uid });
    if (m > 0) byCat[t.title] = (byCat[t.title] || 0) + m;
  }
  const topTasks = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxTop = Math.max(1, ...topTasks.map((x) => x[1]));

  return `
    <div class="card">
      <div class="profile-head">
        ${avatar(u, 'xl')}
        <div class="grow">
          <h1>${esc(u.name)}</h1>
          <div class="sub"><span class="role-badge role-${u.role}">${ROLE_LABEL[u.role]}</span>
            ${team(u.teamId) ? `<span class="flex"><span class="team-dot" style="background:${team(u.teamId).color}"></span>${esc(team(u.teamId).name)}</span>` : ''}
            ${u.title ? `<span>· ${esc(u.title)}</span>` : ''}${u.email ? `<span class="muted">· ${esc(u.email)}</span>` : ''}
            ${u.githubLogin ? `<a class="chip gh" href="https://github.com/${esc(u.githubLogin)}" target="_blank">@${esc(u.githubLogin)}</a>` : ''}</div>
        </div>
        ${!isMe && canManageUser(uid) ? `<button class="btn primary" data-action="new-task" data-assignee="${uid}">+ Assign task</button>` : ''}
        ${!isMe && me().role === 'chair' ? `<button class="btn" data-action="edit-person" data-id="${uid}">Edit</button>` : ''}
        ${isMe ? `<button class="btn" data-action="nav" data-page="settings">Edit profile</button>` : ''}
      </div>
    </div>
    <div class="grid cols-4 mt">
      ${statTile('Active tasks', st.active, `${st.overdue} overdue`, '☰')}
      ${statTile('Completed', st.done, `${st.doneThisWeek} this week`, '✓')}
      ${statTile('Time this week', fmtDur(st.weekMin), `${fmtDur(st.totalMin)} all-time`, '⏱')}
      ${statTile('Avg progress', `${st.avgProgress}%`, 'across active tasks', '%')}
    </div>
    <div class="grid cols-2 mt">
      <div class="card"><div class="card-head"><h3>Time logged · last 14 days</h3><span class="sub">${fmtDur(perDay.reduce((s, p) => s + p.value, 0))}</span></div>${barChart(perDay, fmtDur)}</div>
      <div class="card"><div class="card-head"><h3>Where the time went</h3><span class="sub">top tasks</span></div>
        ${topTasks.length ? topTasks.map(([title, min]) => `<div class="hbar-row" data-tip="${esc(title)}: ${fmtDur(min)}"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</span><div class="track"><div class="fill" style="width:${(min / maxTop) * 100}%"></div></div><span class="v">${fmtDur(min)}</span></div>`).join('') : empty('⏱', 'No time logged yet – start a timer on a task.')}
      </div>
    </div>
    <div class="grid main-side mt">
      <div class="card"><div class="card-head"><h3>Tasks</h3><span class="sub">${tasks.length} total</span></div>
        <div class="compact-list">${tasks.length ? tasks.map(compactRow).join('') : empty('🗂', 'No tasks yet')}</div></div>
      <div class="stack">${githubSection(u, isMe)}</div>
    </div>`;
}

function githubSection(u, isMe) {
  if (!u.githubLogin || (isMe && !u.githubConnected)) {
    if (isMe) {
      return `<div class="card"><div class="card-head"><h3>🐙 Connect GitHub</h3></div>
        <p class="small muted" style="margin-top:0;line-height:1.5">Paste a <a href="https://github.com/settings/tokens?type=beta" target="_blank">fine-grained personal access token</a>
        with read access to <i>Contents, Issues, Pull requests and Metadata</i> on the repos you work on. It's encrypted on this computer and used to auto-update linked tasks.</p>
        <div class="field"><input type="password" id="gh-token" placeholder="github_pat_…"></div>
        <button class="btn primary" data-action="gh-connect">Connect GitHub</button>
        ${u.githubLogin ? `<p class="small muted">Currently showing public data for @${esc(u.githubLogin)}.</p>` : ''}
      </div>${u.githubLogin ? `<div data-gh-panel="${u.id}">${ghPanelInner(u.id)}</div>` : ''}`;
    }
    if (!u.githubLogin) {
      return `<div class="card"><div class="card-head"><h3>🐙 GitHub</h3></div>
        <p class="small muted">${esc(u.name)} hasn't linked GitHub yet.</p>
        ${canManageUser(u.id) ? `<div class="flex"><input type="text" id="gh-login" placeholder="GitHub username"><button class="btn" data-action="gh-set-login" data-id="${u.id}">Link</button></div>` : ''}</div>`;
    }
  }
  return `${isMe ? `<div class="card flex"><span>🐙 Connected as <b>@${esc(u.githubLogin)}</b></span><span class="grow"></span><button class="btn sm ghost" data-action="gh-refresh" data-id="${u.id}">⟳ Refresh</button><button class="btn sm danger" data-action="gh-disconnect">Disconnect</button></div>` : ''}
    <div data-gh-panel="${u.id}">${ghPanelInner(u.id)}</div>`;
}

function ghPanelInner(uid) {
  const g = S.gh[uid];
  if (!g || g.loading) return `<div class="card"><div class="spinner"></div><p class="empty small">Loading GitHub activity…</p></div>`;
  if (g.error) return `<div class="card"><p class="error-text">GitHub: ${esc(g.error)}</p><button class="btn sm" data-action="gh-refresh" data-id="${uid}">Retry</button></div>`;
  const d = g.data;
  if (!d) return '';
  const points = d.commitsByDay.map((c) => ({ label: new Date(c.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), short: String(new Date(c.day).getDate()), value: c.count }));
  return `
    <div class="card">
      <div class="flex" style="margin-bottom:12px"><span class="avatar lg"><img src="${esc(d.user.avatar)}" alt=""></span>
        <div class="grow"><a href="${esc(d.user.url)}" target="_blank"><b style="font-size:15px">${esc(d.user.name || d.user.login)}</b></a><div class="small muted">@${esc(d.user.login)}${d.user.location ? ` · ${esc(d.user.location)}` : ''}</div>
        ${d.user.bio ? `<div class="small" style="margin-top:4px;color:var(--text-2)">${esc(d.user.bio)}</div>` : ''}</div></div>
      <div class="grid cols-3" style="gap:10px;margin-bottom:14px">
        <div><div class="small muted">Commits (30d)</div><b style="font-size:20px">${d.commits30}</b></div>
        <div><div class="small muted">Public repos</div><b style="font-size:20px">${d.user.publicRepos}</b></div>
        <div><div class="small muted">Followers</div><b style="font-size:20px">${d.user.followers}</b></div>
      </div>
      <div class="small muted" style="margin-bottom:2px">Commits pushed · last 14 days</div>
      ${barChart(points, (v) => `${v} commit${v === 1 ? '' : 's'}`)}
    </div>
    ${d.openPRs.length ? `<div class="card"><div class="card-head"><h3>⑂ Open pull requests</h3><span class="sub">${d.openPRs.length}</span></div>
      ${d.openPRs.map((p) => `<div class="repo"><a href="${esc(p.url)}" target="_blank">${esc(p.title)}</a><div class="d">${esc(p.repo)} #${p.number}</div></div>`).join('')}</div>` : ''}
    <div class="card"><div class="card-head"><h3>Recently active repos</h3></div>
      ${d.repos.length ? d.repos.map((r) => `<div class="repo"><a href="${esc(r.url)}" target="_blank">${esc(r.name)}</a>${r.description ? `<div class="d">${esc(r.description)}</div>` : ''}
        <div class="m">${r.language ? `<span>● ${esc(r.language)}</span>` : ''}<span>★ ${r.stars}</span><span>⑂ ${r.forks}</span><span>pushed ${relTime(r.pushedAt)}</span></div></div>`).join('') : empty('📦', 'No public repos')}
    </div>
    <div class="card"><div class="card-head"><h3>GitHub activity</h3><span class="sub">updated ${relTime(d.fetchedAt)}</span></div>
      ${d.recent.length ? d.recent.map((e) => `<div class="feed-item"><div><div style="color:var(--text)">${esc(e.text)}</div><div class="small muted">${esc(e.repo)}</div></div><span class="when">${relTime(e.at)}</span></div>`).join('') : empty('·', 'No recent public activity')}
    </div>`;
}

async function loadGithubPanel(uid, force = false) {
  const g = S.gh[uid];
  if (!force && g && (g.loading || g.data || g.error)) return;
  S.gh[uid] = { loading: true };
  try {
    S.gh[uid] = { data: await api('githubProfile', uid, force) };
  } catch (err) {
    S.gh[uid] = { error: err.message };
  }
  const el = $(`[data-gh-panel="${uid}"]`);
  if (el) el.innerHTML = ghPanelInner(uid);
}

// ============================================================ settings
function pageSettings() {
  const s = S.data.settings;
  return `
    <div class="grid cols-2">
      <div class="stack">
        <form class="card" id="profile-form">
          <div class="card-head"><h3>Your account</h3></div>
          <div class="field"><label>Name</label><input type="text" name="name" value="${esc(me().name)}"></div>
          <div class="row"><div class="field"><label>Email</label><input type="email" name="email" value="${esc(me().email)}"></div>
          <div class="field"><label>Title / position</label><input type="text" name="title" value="${esc(me().title)}" placeholder="e.g. Web lead"></div></div>
          <button class="btn primary" type="submit">Save</button>
        </form>
        <form class="card" id="password-form">
          <div class="card-head"><h3>Change password</h3></div>
          <div class="field"><label>Current password</label><input type="password" name="current" required></div>
          <div class="field"><label>New password</label><input type="password" name="next" minlength="6" required></div>
          <button class="btn" type="submit">Update password</button>
        </form>
        <div class="card flex"><span class="grow">Signed in as <b>${esc(me().username)}</b></span><button class="btn danger" data-action="logout">Sign out</button></div>
      </div>
      ${me().role === 'chair' ? `
      <form class="card" id="settings-form">
        <div class="card-head"><h3>Workspace</h3><span class="sub">chairperson only</span></div>
        <div class="field"><label>Organisation name</label><input type="text" name="orgName" value="${esc(S.data.orgName)}"></div>
        <div class="row">
          <div class="field"><label>Deadline reminder (hours before)</label><input type="number" name="reminderLeadHours" min="1" value="${s.reminderLeadHours}"></div>
          <div class="field"><label>GitHub sync every (minutes)</label><input type="number" name="githubSyncMinutes" min="1" value="${s.githubSyncMinutes}"></div>
        </div>
        <div class="field"><label>Anthropic API key (for AI event follow-ups)</label>
          <input type="password" name="anthropicKey" placeholder="${s.aiConfigured ? '•••••••• configured – type to replace' : 'sk-ant-…'}">
          <span class="hint">When a task for an event is completed, Claude searches the web and suggests next steps (sponsor follow-ups, reports, recaps…). Without a key a built-in checklist is used.</span></div>
        <label class="flex" style="margin-bottom:16px"><input type="checkbox" name="keepRunningInTray" ${s.keepRunningInTray ? 'checked' : ''}> Keep running in the system tray when the window is closed (so reminders still fire)</label>
        <div class="flex"><button class="btn primary" type="submit">Save settings</button>${s.aiConfigured ? '<button class="btn ghost" type="button" data-action="clear-ai-key">Remove API key</button>' : ''}</div>
      </form>` : `<div class="card"><div class="card-head"><h3>Reminders</h3></div><p class="muted">You'll get a desktop notification ${s.reminderLeadHours}h before each deadline, when something is overdue, and for any custom reminders on your tasks.</p></div>`}
    </div>`;
}

// ============================================================ notifications
function renderNotifPanel() {
  const list = S.data.notifications;
  return `<div class="notif-panel">
    <div class="head"><b>Notifications</b><button class="btn sm ghost" data-action="notifs-read">Mark all read</button></div>
    ${list.length ? list.slice(0, 60).map((n) => `
      <div class="notif ${n.read ? '' : 'unread'}" data-action="notif-open" data-id="${n.id}" data-task="${n.taskId || ''}">
        <div><div>${esc(n.text)}</div><div class="when">${relTime(n.at)}</div></div>
      </div>`).join('') : empty('🔕', 'You are all caught up')}
  </div>`;
}

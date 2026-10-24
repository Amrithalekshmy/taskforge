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

// ============================================================ task drawer
function openTask(id) {
  S.drawerTaskId = id;
  S.notifOpen = false;
  // A just-created task may not be in our snapshot yet – refresh renders the drawer.
  if (task(id)) renderDrawer();
  else refresh();
}

function closeDrawer() {
  S.drawerTaskId = null;
  $('#drawer-root').innerHTML = '';
}

function renderDrawer() {
  const t = task(S.drawerTaskId);
  if (!t) return closeDrawer();
  const manage = canManageTask(t);
  const work = canWorkTask(t);
  const scroll = $('.drawer-body')?.scrollTop || 0;
  const children = S.data.tasks.filter((x) => x.parentTaskId === t.id);
  const parent = t.parentTaskId && task(t.parentTaskId);
  const total = minutesOn(t);
  const perUser = {};
  for (const l of t.timeLogs) perUser[l.userId] = (perUser[l.userId] || 0) + l.minutes;
  if (t.timer) perUser[t.timer.userId] = (perUser[t.timer.userId] || 0) + (Date.now() - Date.parse(t.timer.start)) / 60000;
  const maxUser = Math.max(1, ...Object.values(perUser));
  const myTimer = t.timer?.userId === me().id;

  $('#drawer-root').innerHTML = `
    <div class="drawer-backdrop" data-action="close-drawer"></div>
    <aside class="drawer">
      <div class="drawer-head">
        <div class="flex wrap">${prioChip(t.priority)}${t.category !== 'general' ? `<span class="chip violet">${esc(t.category)}</span>` : ''}${deadlineChip(t)}${ghChip(t)}
          <span class="grow"></span>
          ${manage ? `<button class="btn sm ghost" data-action="edit-task" data-id="${t.id}">✎ Edit</button><button class="btn sm ghost danger" data-action="delete-task" data-id="${t.id}">🗑</button>` : ''}
          <button class="btn sm ghost" data-action="close-drawer">✕</button></div>
        <h2>${esc(t.title)}</h2>
        <div class="small muted">Assigned by ${esc(user(t.assignedById)?.name || '—')} to <b style="color:var(--text)">${esc(user(t.assigneeId)?.name || '—')}</b> · created ${relTime(t.createdAt)}${parent ? ` · follow-up of <a href="#" data-action="open-task" data-id="${parent.id}">${esc(parent.title)}</a>` : ''}</div>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="section-title">Progress<span class="grow"></span>
            ${work && t.status !== 'done' ? `<select data-change="progress-mode" data-id="${t.id}" style="width:auto;padding:4px 8px;font-size:12px">
              <option value="manual" ${t.progressMode === 'manual' ? 'selected' : ''}>Manual</option>
              <option value="checklist" ${t.progressMode === 'checklist' ? 'selected' : ''}>From checklist</option>
              ${t.github ? `<option value="github" ${t.progressMode === 'github' ? 'selected' : ''}>From GitHub</option>` : ''}</select>` : `<span class="small">${t.progressMode}</span>`}
          </div>
          ${progressBar(t, 'lg')}
          ${work && t.progressMode === 'manual' && t.status !== 'done' ? `<input type="range" min="0" max="100" step="5" value="${t.progress}" data-change="progress" data-id="${t.id}" style="margin-top:10px">` : ''}
          <div style="margin-top:10px">${suggestDone(t)}</div>
          <div class="seg" style="margin-top:12px">${Object.entries(STATUS).map(([k, l]) => `<button class="${t.status === k ? 'on' : ''}" ${work ? `data-action="set-status" data-id="${t.id}" data-status="${k}"` : 'disabled'}>${l}</button>`).join('')}</div>
        </div>

        ${t.description ? `<div class="section"><div class="section-title">Description</div><div class="desc">${esc(t.description)}</div></div>` : ''}

        <div class="section"><div class="section-title">Details</div>
          <div class="kv">
            <span class="k">Assignee</span><span>${person(user(t.assigneeId))}</span>
            <span class="k">Assigned by</span><span>${person(user(t.assignedById))}</span>
            <span class="k">Team</span><span>${team(t.teamId) ? `<span class="flex"><span class="team-dot" style="background:${team(t.teamId).color}"></span>${esc(team(t.teamId).name)}</span>` : '—'}</span>
            <span class="k">Deadline</span><span>${fmtDate(t.deadline)}</span>
            <span class="k">Time</span><span>${fmtDur(total)} logged${t.estimateHours ? ` of ${t.estimateHours}h estimated` : ''}</span>
            ${t.completedAt ? `<span class="k">Completed</span><span>${fmtDate(t.completedAt)}</span>` : ''}
            ${t.tags.length ? `<span class="k">Tags</span><span class="flex wrap">${t.tags.map((x) => `<span class="chip">#${esc(x)}</span>`).join('')}</span>` : ''}
          </div>
        </div>

        <div class="section"><div class="section-title">Checklist<span class="grow"></span>${t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ''}</div>
          ${t.subtasks.map((s) => `<label class="checklist-item ${s.done ? 'done' : ''}">
              <input type="checkbox" ${s.done ? 'checked' : ''} ${work ? `data-change="subtask" data-id="${t.id}" data-sub="${s.id}"` : 'disabled'}>
              <span>${esc(s.text)}</span>${work ? `<button class="btn sm ghost x" data-action="subtask-del" data-id="${t.id}" data-sub="${s.id}">✕</button>` : ''}
            </label>`).join('')}
          ${work ? `<form class="flex" data-form="subtask-add" data-id="${t.id}" style="margin-top:6px"><input type="text" name="text" placeholder="Add a checklist item…"><button class="btn sm" type="submit">Add</button></form>` : ''}
        </div>

        <div class="section"><div class="section-title">Time tracking</div>
          <div class="timer-box">
            <div class="grow"><div class="small muted">Total time on this task</div><div class="big" ${t.timer ? `data-total-start="${Date.parse(t.timer.start)}" data-total-base="${Math.round((total - (Date.now() - Date.parse(t.timer.start)) / 60000) * 60000)}"` : ''}>${fmtClock(total * 60000)}</div>
              ${t.timer && !myTimer ? `<div class="small" style="color:#7ee07e">● ${esc(user(t.timer.userId)?.name || '')} is working on this now</div>` : ''}</div>
            ${work && t.status !== 'done' ? `<button class="btn ${myTimer ? 'timer-on' : 'primary'}" data-action="toggle-timer" data-id="${t.id}">${myTimer ? '■ Stop timer' : '▶ Start timer'}</button>` : ''}
          </div>
          ${work ? `<form class="flex" data-form="log-time" data-id="${t.id}" style="margin-top:10px">
            <input type="number" name="minutes" min="1" placeholder="Minutes" style="width:110px"><input type="text" name="note" placeholder="What did you do? (optional)"><button class="btn sm" type="submit">Log time</button></form>` : ''}
          ${Object.keys(perUser).length ? `<div style="margin-top:12px">${Object.entries(perUser).sort((a, b) => b[1] - a[1]).map(([uid, m]) => `
            <div class="hbar-row" data-tip="${esc(user(uid)?.name || 'Former member')}: ${fmtDur(m)}">${person(user(uid))}<div class="track"><div class="fill" style="width:${(m / maxUser) * 100}%"></div></div><span class="v">${fmtDur(m)}</span></div>`).join('')}</div>` : ''}
          ${t.timeLogs.length ? `<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${t.timeLogs.length} time entries</summary>
            ${[...t.timeLogs].reverse().map((l) => `<div class="log-row">${avatar(user(l.userId), 'sm')}<span class="grow">${esc(l.note || 'Timer session')}</span><span>${fmtDur(l.minutes)}</span><span class="muted">${fmtDate(l.end)}</span></div>`).join('')}</details>` : ''}
        </div>

        <div class="section"><div class="section-title">GitHub<span class="grow"></span>${t.github ? `<button class="btn sm ghost" data-action="sync-task" data-id="${t.id}">⟳ Sync now</button>` : ''}</div>
          ${t.github ? ghTaskBox(t, work) : work ? `
            <form data-form="gh-link" data-id="${t.id}">
              <p class="small muted" style="margin-top:0">Link an issue, PR or milestone. Progress updates automatically, and the task completes itself when the issue closes / PR merges / milestone finishes.</p>
              <div class="row"><div class="field"><input type="text" name="repo" placeholder="owner/repo" list="repo-list"></div>
                <div class="field" style="flex:.6"><select name="type"><option value="issue">Issue</option><option value="pr">Pull request</option><option value="milestone">Milestone</option></select></div>
                <div class="field" style="flex:.5"><input type="number" name="number" placeholder="#"></div></div>
              <button class="btn sm primary" type="submit">Link to GitHub</button>
            </form>` : '<span class="muted small">Not linked</span>'}
        </div>

        <div class="section"><div class="section-title">Reminders</div>
          ${t.deadline && t.status !== 'done' ? `<div class="log-row">⏰<span class="grow">Automatic: ${S.data.settings.reminderLeadHours}h before the deadline</span><span class="chip ${t.deadlineReminded ? 'good' : ''}">${t.deadlineReminded ? 'sent' : 'scheduled'}</span></div>` : ''}
          ${t.reminders.map((r) => `<div class="log-row">🔔<span class="grow">${esc(r.text || 'Reminder')} <span class="muted">· ${fmtDate(r.at)}</span></span><span class="chip ${r.sent ? 'good' : 'accent'}">${r.sent ? 'sent' : relTime(r.at)}</span>
            ${work ? `<button class="btn sm ghost" data-action="reminder-del" data-id="${t.id}" data-rem="${r.id}">✕</button>` : ''}</div>`).join('')}
          ${work ? `<form class="flex" data-form="reminder-add" data-id="${t.id}" style="margin-top:8px"><input type="datetime-local" name="at" style="width:210px" required><input type="text" name="text" placeholder="e.g. Call sponsors to confirm stall"><button class="btn sm" type="submit">Add</button></form>` : ''}
        </div>

        <div class="section"><div class="section-title">Event & follow-ups</div>
          ${t.event ? `<div class="kv"><span class="k">Event</span><span><b>${esc(t.event.name)}</b>${t.event.type ? ` <span class="chip">${esc(t.event.type)}</span>` : ''}</span>
            ${t.event.date ? `<span class="k">Date</span><span>${esc(t.event.date)}</span>` : ''}</div>` : ''}
          ${children.length ? `<div class="compact-list" style="margin-top:8px">${sortTasks(children).map(compactRow).join('')}</div>` : ''}
          <button class="btn sm" style="margin-top:10px" data-action="event-flow" data-id="${t.id}">✨ ${t.event ? 'Suggest more next steps' : 'Is this for an event? Plan follow-ups'}</button>
        </div>

        <div class="section"><div class="section-title">Comments</div>
          ${t.comments.map((c) => `<div class="comment">${avatar(user(c.userId), 'sm')}<div class="body"><div class="meta"><b style="color:var(--text)">${esc(user(c.userId)?.name || 'Someone')}</b> · ${relTime(c.at)}</div>${esc(c.text)}</div></div>`).join('')}
          <form class="flex" data-form="comment" data-id="${t.id}" style="margin-top:10px"><input type="text" name="text" placeholder="Write a comment…"><button class="btn sm" type="submit">Send</button></form>
        </div>
      </div>
    </aside>
    <datalist id="repo-list">${(S.myRepos || []).map((r) => `<option value="${esc(r)}">`).join('')}</datalist>`;
  $('.drawer-body').scrollTop = scroll;
  loadMyRepos();
}

function ghTaskBox(t, work) {
  const g = t.github;
  const i = g.info || {};
  const kind = { issue: 'Issue', pr: 'Pull request', milestone: 'Milestone' }[g.type];
  const stateCls = { merged: 'violet', closed: 'good', open: 'accent', draft: '' }[g.state] || '';
  const stats = [];
  if (g.type === 'pr') {
    if (i.commits != null) stats.push(`${i.commits} commits`, `<span style="color:#3fb950">+${i.additions}</span> <span style="color:#f85149">−${i.deletions}</span>`, `${i.changedFiles} files`);
    if (i.branch) stats.push(`⑂ ${esc(i.branch)}`);
    if (i.approved) stats.push('✓ approved');
    if (i.reviewers?.length) stats.push(`reviewers: ${i.reviewers.map(esc).join(', ')}`);
  }
  if (g.type === 'issue') {
    if (i.comments != null) stats.push(`${i.comments} comments`);
    if (i.labels?.length) stats.push(i.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join(' '));
    if (i.assignees?.length) stats.push(`assignees: ${i.assignees.map(esc).join(', ')}`);
  }
  if (g.type === 'milestone' && i.openIssues != null) stats.push(`${i.closedIssues} closed`, `${i.openIssues} open`, i.dueOn ? `due ${fmtDate(i.dueOn, false)}` : '');
  if (i.checklist?.total) stats.push(`☑ ${i.checklist.done}/${i.checklist.total} checklist`);
  return `<div class="gh-box">
    <div class="flex"><span class="small" style="color:#9198a1">${kind} · ${esc(g.repo)} #${g.number}</span><span class="grow"></span>${g.state ? `<span class="chip ${stateCls}">${esc(g.state)}</span>` : ''}</div>
    <div class="t" style="margin-top:6px">${i.url ? `<a href="${esc(i.url)}" target="_blank">${esc(i.title)}</a>` : '<span class="muted">Waiting for first sync…</span>'}</div>
    ${stats.length ? `<div class="gh-stats">${stats.filter(Boolean).map((s) => `<span>${s}</span>`).join('')}</div>` : ''}
    ${g.error ? `<div class="error-text" style="margin:8px 0 0">⚠ ${esc(g.error)}</div>` : ''}
    <div class="flex small" style="margin-top:10px;color:#9198a1">${g.lastSync ? `Synced ${relTime(g.lastSync)}` : 'Not synced yet'}<span class="grow"></span>
      ${work ? `<button class="btn sm ghost" data-action="gh-unlink" data-id="${t.id}">Unlink</button>` : ''}</div>
  </div>`;
}

async function loadMyRepos() {
  if (S.myRepos !== null) return;
  S.myRepos = [];
  try {
    S.myRepos = await api('githubMyRepos');
    const dl = $('#repo-list');
    if (dl) dl.innerHTML = S.myRepos.map((r) => `<option value="${esc(r)}">`).join('');
  } catch {}
}

// ============================================================ modals
function openModal(html, { wide = false } = {}) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  const first = $('#modal-root input:not([type=hidden]), #modal-root textarea');
  if (first) first.focus();
  return $('#modal-root .modal');
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function confirmModal(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = openModal(`<div class="modal-head"><div class="grow"><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>
      <div class="modal-foot"><button class="btn" data-x="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="yes">${esc(okLabel)}</button></div>`);
    m.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (!x) return;
      closeModal();
      resolve(x === 'yes');
    };
  });
}

// ---------- task form ----------
function taskForm(existing = null, preset = {}) {
  const t = existing || {};
  const assignable = S.data.users.filter((u) => canManageUser(u.id));
  const assigneeId = t.assigneeId || preset.assignee || (preset.team ? '' : me().id);
  const teamMembers = preset.team ? assignable.filter((u) => u.teamId === preset.team) : assignable;
  const subs = (t.subtasks || []).map((s) => s.text);
  const reminders = t.reminders || [];

  const m = openModal(`
    <div class="modal-head"><div class="grow"><h2>${existing ? 'Edit task' : 'New task'}</h2>
      <p>${isManager() ? 'Assign work to someone in your team, set a deadline and optional GitHub link.' : 'Create a personal task to track your own work.'}</p></div>
      <button class="btn sm ghost" data-x="close">✕</button></div>
    <form class="modal-body" id="task-form">
      <div class="field"><label>Title *</label><input type="text" name="title" value="${esc(t.title || '')}" required placeholder="What needs to be done?"></div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="Details, links, acceptance criteria…">${esc(t.description || '')}</textarea></div>
      <div class="row">
        <div class="field"><label>Assignee</label><select name="assigneeId" ${assignable.length < 2 ? 'disabled' : ''}>
          ${(assignable.length ? (teamMembers.length ? teamMembers : assignable) : [me()]).map((u) => `<option value="${u.id}" ${u.id === assigneeId ? 'selected' : ''}>${esc(u.name)}${u.id === me().id ? ' (me)' : ''}${team(u.teamId) ? ` – ${esc(team(u.teamId).name)}` : ''}</option>`).join('')}
        </select></div>
        <div class="field"><label>Priority</label><select name="priority">${Object.entries(PRIORITY).map(([k, [l]]) => `<option value="${k}" ${(t.priority || 'medium') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Deadline</label><input type="datetime-local" name="deadline" value="${toLocalInput(t.deadline)}"><span class="hint">A reminder is sent ${S.data.settings.reminderLeadHours}h before.</span></div>
        <div class="field"><label>Estimate (hours)</label><input type="number" name="estimateHours" min="0" step="0.5" value="${t.estimateHours || ''}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Category</label><select name="category">${CATEGORIES.map((c) => `<option ${(t.category || 'general') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span class="hint">Pick "event" so completion triggers follow-up suggestions.</span></div>
        <div class="field"><label>Tags</label><input type="text" name="tags" value="${esc((t.tags || []).join(', '))}" placeholder="comma separated"></div>
      </div>
      ${existing ? '' : `
      <fieldset class="fieldset"><legend>Checklist (optional – drives the progress bar)</legend>
        <div class="sub-editor" id="sub-editor">${(subs.length ? subs : ['']).map((s) => subLine(s)).join('')}</div>
        <button class="btn sm ghost" type="button" data-x="add-sub" style="margin:8px 0 12px">+ Add item</button>
      </fieldset>`}
      <fieldset class="fieldset"><legend>GitHub link (optional – auto-updates progress & completion)</legend>
        <div class="row">
          <div class="field"><input type="text" name="ghRepo" list="form-repo-list" placeholder="owner/repo" value="${esc(t.github?.repo || '')}"></div>
          <div class="field" style="flex:.6"><select name="ghType">${['issue', 'pr', 'milestone'].map((x) => `<option value="${x}" ${t.github?.type === x ? 'selected' : ''}>${{ issue: 'Issue', pr: 'Pull request', milestone: 'Milestone' }[x]}</option>`).join('')}</select></div>
          <div class="field" style="flex:.5"><input type="number" name="ghNumber" placeholder="#" list="gh-items" value="${t.github?.number || ''}"></div>
        </div>
        <datalist id="form-repo-list">${(S.myRepos || []).map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
        <datalist id="gh-items"></datalist>
        <div class="hint small muted" id="gh-hint" style="margin:-6px 0 12px"></div>
      </fieldset>
      <fieldset class="fieldset"><legend>Extra reminders</legend>
        <div class="sub-editor" id="rem-editor">${reminders.map((r) => remLine(r)).join('')}</div>
        <button class="btn sm ghost" type="button" data-x="add-rem" style="margin:8px 0 12px">+ Add reminder</button>
      </fieldset>
      <div class="error-text" id="task-err"></div>
    </form>
    <div class="modal-foot"><button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">${existing ? 'Save changes' : 'Create task'}</button></div>`, { wide: true });

  loadMyRepos().then(() => {
    const dl = $('#form-repo-list');
    if (dl) dl.innerHTML = (S.myRepos || []).map((r) => `<option value="${esc(r)}">`).join('');
  });

  const form = $('#task-form');
  let itemsCache = null;
  const refreshItems = async () => {
    const repo = form.ghRepo.value.trim();
    if (!repo.includes('/')) return;
    $('#gh-hint').textContent = 'Loading open items…';
    try {
      itemsCache = await api('githubRepoItems', repo);
      fillItems();
    } catch (err) {
      $('#gh-hint').textContent = `⚠ ${err.message}`;
      itemsCache = null;
    }
  };
  const fillItems = () => {
    if (!itemsCache) return;
    const key = { issue: 'issues', pr: 'pulls', milestone: 'milestones' }[form.ghType.value];
    const items = itemsCache[key];
    $('#gh-items').innerHTML = items.map((i) => `<option value="${i.number}">#${i.number} ${esc(i.title)}</option>`).join('');
    $('#gh-hint').textContent = items.length ? `${items.length} open ${key} – click the # field to pick one.` : `No open ${key} found in ${itemsCache.repo}.`;
  };
  form.ghRepo.addEventListener('change', refreshItems);
  form.ghType.addEventListener('change', fillItems);
  if (t.github?.repo) refreshItems();

  m.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeModal();
    if (x === 'add-sub') { $('#sub-editor').insertAdjacentHTML('beforeend', subLine('')); $('#sub-editor input:last-of-type')?.focus(); }
    if (x === 'add-rem') $('#rem-editor').insertAdjacentHTML('beforeend', remLine({}));
    if (x === 'del-line') e.target.closest('.line').remove();
    if (x === 'save') form.requestSubmit();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      title: fd.get('title'),
      description: fd.get('description'),
      assigneeId: fd.get('assigneeId') || assigneeId || me().id,
      priority: fd.get('priority'),
      deadline: fromLocalInput(fd.get('deadline')),
      estimateHours: fd.get('estimateHours'),
      category: fd.get('category'),
      tags: String(fd.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean),
      reminders: $$('#rem-editor .line').map((l) => ({ id: l.dataset.id || undefined, at: fromLocalInput($('input[name=remAt]', l).value), text: $('input[name=remText]', l).value, sent: false })).filter((r) => r.at),
      github: fd.get('ghRepo') ? { repo: fd.get('ghRepo'), type: fd.get('ghType'), number: fd.get('ghNumber') } : null,
    };
    if (!existing) data.subtasks = $$('#sub-editor input').map((i) => ({ text: i.value })).filter((s) => s.text.trim());
    if (existing) {
      // Keep GitHub link untouched if unchanged, so sync state isn't reset.
      const g = existing.github;
      if (g && data.github && g.repo === data.github.repo && g.type === data.github.type && String(g.number) === String(data.github.number)) delete data.github;
    }
    try {
      const saved = existing ? await api('updateTask', existing.id, data) : await api('createTask', data);
      closeModal();
      toast(existing ? 'Task updated' : `Task created${data.assigneeId !== me().id ? ` and assigned to ${user(data.assigneeId)?.name}` : ''}`, 'success');
      if (!existing) openTask(saved.id);
    } catch (err) {
      $('#task-err').textContent = err.message;
    }
  };
}

function subLine(text) {
  return `<div class="line"><input type="text" value="${esc(text)}" placeholder="Checklist item"><button class="btn sm ghost" type="button" data-x="del-line">✕</button></div>`;
}

function remLine(r) {
  return `<div class="line" data-id="${esc(r.id || '')}"><input type="datetime-local" name="remAt" value="${toLocalInput(r.at)}" style="width:220px"><input type="text" name="remText" value="${esc(r.text || '')}" placeholder="Reminder text, e.g. Confirm sponsor logos"><button class="btn sm ghost" type="button" data-x="del-line">✕</button></div>`;
}

// ---------- person form ----------
function personForm(existing = null, presetTeam = null) {
  const chair = me().role === 'chair';
  const myTeams = teamsIHead();
  const u = existing || {};
  const m = openModal(`
    <div class="modal-head"><div class="grow"><h2>${existing ? `Edit ${esc(u.name)}` : 'Add a person'}</h2>
      <p>${existing ? 'Update their details, role or team.' : 'Create an account. Share the username and password with them so they can sign in on this app.'}</p></div></div>
    <form class="modal-body" id="person-form">
      <div class="row"><div class="field"><label>Full name *</label><input type="text" name="name" value="${esc(u.name || '')}" required></div>
        <div class="field"><label>Username *</label><input type="text" name="username" value="${esc(u.username || '')}" ${existing ? 'disabled' : 'required'}></div></div>
      <div class="row"><div class="field"><label>Email</label><input type="email" name="email" value="${esc(u.email || '')}"></div>
        <div class="field"><label>Title / position</label><input type="text" name="title" value="${esc(u.title || '')}" placeholder="e.g. Design lead"></div></div>
      <div class="row">
        ${chair ? `<div class="field"><label>Role</label><select name="role">${['member', 'head', 'chair'].map((r) => `<option value="${r}" ${(u.role || 'member') === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>Team</label><select name="teamId">${chair ? '<option value="">No team</option>' : ''}${myTeams.map((t) => `<option value="${t.id}" ${(u.teamId || presetTeam) === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>${existing ? 'Reset password (leave blank to keep)' : 'Temporary password *'}</label><input type="text" name="password" ${existing ? '' : 'required minlength="6"'} placeholder="min. 6 characters"></div>
      <div class="field"><label>GitHub username (optional)</label><input type="text" name="githubLogin" value="${esc(u.githubLogin || '')}" placeholder="so their public activity shows up"></div>
      <div class="error-text" id="person-err"></div>
    </form>
    <div class="modal-foot">${existing && chair ? '<button class="btn danger" data-x="delete">Remove person</button>' : ''}<span class="grow"></span>
      <button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">${existing ? 'Save' : 'Add person'}</button></div>`);
  const form = $('#person-form');
  m.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeModal();
    if (x === 'save') form.requestSubmit();
    if (x === 'delete' && await confirmModal(`Remove ${u.name}?`, 'Their account is deleted. Tasks assigned to them become unassigned.', 'Remove', true)) {
      run(() => api('deleteUser', u.id), 'Person removed');
      if (S.page === 'member') S.page = 'org';
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const saved = existing ? await api('updateUser', u.id, data) : await api('createUser', data);
      if ((data.githubLogin || '') !== (u.githubLogin || '')) await api('setGithubLogin', saved.id, data.githubLogin);
      closeModal();
      toast(existing ? 'Saved' : `${saved.name} added – username "${saved.username}"`, 'success');
    } catch (err) {
      $('#person-err').textContent = err.message;
    }
  };
}

// ---------- team form ----------
function teamForm(existing = null) {
  const t = existing || {};
  const m = openModal(`
    <div class="modal-head"><div class="grow"><h2>${existing ? 'Edit team' : 'New team'}</h2><p>Each team has a head who can assign work and track their members.</p></div></div>
    <form class="modal-body" id="team-form">
      <div class="field"><label>Team name *</label><input type="text" name="name" value="${esc(t.name || '')}" required placeholder="e.g. Web Development, Events, Sponsorship"></div>
      <div class="field"><label>Description</label><input type="text" name="description" value="${esc(t.description || '')}"></div>
      <div class="field"><label>Head</label><select name="headId"><option value="">— choose later —</option>
        ${S.data.users.map((u) => `<option value="${u.id}" ${t.headId === u.id ? 'selected' : ''}>${esc(u.name)} (${ROLE_LABEL[u.role]})</option>`).join('')}</select>
        <span class="hint">Members picked as head are promoted to Head automatically.</span></div>
      <div class="error-text" id="team-err"></div>
    </form>
    <div class="modal-foot">${existing ? '<button class="btn danger" data-x="delete">Delete team</button>' : ''}<span class="grow"></span>
      <button class="btn" data-x="close">Cancel</button><button class="btn primary" data-x="save">${existing ? 'Save' : 'Create team'}</button></div>`);
  const form = $('#team-form');
  m.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeModal();
    if (x === 'save') form.requestSubmit();
    if (x === 'delete' && await confirmModal(`Delete ${t.name}?`, 'Members stay but are no longer in a team. Tasks are kept.', 'Delete', true)) {
      run(() => api('deleteTeam', t.id), 'Team deleted');
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await (existing ? api('updateTeam', t.id, data) : api('createTeam', data));
      closeModal();
      toast(existing ? 'Team saved' : 'Team created', 'success');
    } catch (err) {
      $('#team-err').textContent = err.message;
    }
  };
}

// ---------- event follow-up flow ----------
function eventFlow(taskId, { askFirst = true } = {}) {
  const t = task(taskId);
  if (!t) return;
  const step = askFirst && !t.event ? 'ask' : 'form';
  const guess = t.event?.name || t.tags.find((x) => /fest|hack|summit|conf|meet|event/i.test(x)) || t.title;
  const head = `<div class="modal-head"><div class="grow"><h2>🎉 "${esc(t.title)}" is done!</h2>`;

  if (step === 'ask') {
    const m = openModal(`${head}<p>This looks like it was part of an event. Was it? If so, TaskForge can research what to do next – sponsor follow-ups, payments, recaps and the small things that get forgotten.</p></div></div>
      <div class="modal-foot"><button class="btn" data-x="no">No, it wasn't</button><button class="btn primary" data-x="yes">Yes, it was for an event</button></div>`);
    m.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'no') closeModal();
      if (x === 'yes') eventFlow(taskId, { askFirst: false });
    };
    return;
  }

  const m = openModal(`${head}<p>Tell us about the event and we'll suggest next steps${S.data.settings.aiConfigured ? ' using a live web search' : ''}.</p></div><button class="btn sm ghost" data-x="close">✕</button></div>
    <form class="modal-body" id="event-form">
      <div class="row"><div class="field"><label>Event name *</label><input type="text" name="name" value="${esc(guess)}" required></div>
        <div class="field"><label>Type</label><select name="type">${['Hackathon', 'Workshop', 'Tech talk / seminar', 'Conference', 'Cultural fest', 'Competition', 'Meetup', 'Webinar', 'Fundraiser', 'Product launch', 'Other'].map((x) => `<option ${t.event?.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
      <div class="field"><label>Event date</label><input type="date" name="date" value="${esc(t.event?.date || '')}"></div>
      <div class="field"><label>Notes for better suggestions</label><textarea name="notes" placeholder="e.g. 3 sponsors (Acme, Globex…), 200 attendees, prizes still pending, venue was the main auditorium">${esc(t.event?.notes || '')}</textarea></div>
    </form>
    <div class="modal-foot"><button class="btn" data-x="close">Skip</button><button class="btn primary" data-x="go">✨ Suggest next steps</button></div>`);
  const form = $('#event-form');
  m.onclick = (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeModal();
    if (x === 'go') form.requestSubmit();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const event = Object.fromEntries(new FormData(form));
    $('#modal-root .modal').innerHTML = `<div class="modal-body" style="text-align:center;padding:40px">
      <div class="spinner"></div><h3>Researching next steps for ${esc(event.name)}…</h3>
      <p class="muted small">${S.data.settings.aiConfigured ? 'Claude is searching the web for best practices. This can take up to a minute.' : 'Preparing the standard post-event checklist.'}</p></div>`;
    try {
      const result = await api('suggestFollowups', taskId, event);
      showSuggestions(taskId, event, result);
    } catch (err) {
      closeModal();
      toast(err.message, 'error');
    }
  };
}

function showSuggestions(taskId, event, result) {
  const people = S.data.users.filter((u) => canManageUser(u.id));
  const t = task(taskId);
  const defaultAssignee = canManageUser(t?.assigneeId) ? t.assigneeId : me().id;
  const m = openModal(`
    <div class="modal-head"><div class="grow"><h2>Next steps for ${esc(event.name)}</h2>
      <p>${esc(result.summary || '')}</p>
      ${result.error ? `<p class="error-text">${esc(result.error)}</p>` : ''}
      <p class="small muted">${result.source === 'ai' ? '✨ Researched by Claude with web search.' : '📋 Built-in checklist.'} Pick the steps to turn into tasks – each gets a deadline and a reminder.</p></div>
      <button class="btn sm ghost" data-x="close">✕</button></div>
    <div class="modal-body">
      ${result.steps.map((s, i) => `<div class="step" data-i="${i}">
        <input type="checkbox" checked data-x="toggle">
        <div><div class="t">${esc(s.title)} ${s.kind ? `<span class="chip">${esc(s.kind)}</span>` : ''} ${prioChip(s.priority)}</div><div class="d">${esc(s.description || '')}</div></div>
        <select name="assignee">${people.map((u) => `<option value="${u.id}" ${u.id === defaultAssignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <div><input type="number" name="days" min="0" value="${Number(s.dueInDays) || 3}" data-tip="Due in N days"><div class="small muted" style="margin-top:3px">days</div></div>
      </div>`).join('')}
      ${result.sources?.length ? `<div class="sources"><b>Sources</b>${result.sources.map((s) => `<a href="${esc(s.url)}" target="_blank">${esc(s.title || s.url)}</a>`).join('')}</div>` : ''}
    </div>
    <div class="modal-foot"><span class="small muted grow" id="sel-count"></span><button class="btn" data-x="close">Not now</button><button class="btn primary" data-x="create">Create selected tasks</button></div>`, { wide: true });
  const count = () => { $('#sel-count').textContent = `${$$('.step input[type=checkbox]:checked').length} selected`; };
  count();
  m.onclick = async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeModal();
    if (x === 'toggle') { e.target.closest('.step').classList.toggle('off', !e.target.checked); count(); }
    if (x === 'create') {
      const steps = $$('.step').filter((el) => $('input[type=checkbox]', el).checked).map((el) => ({
        ...result.steps[el.dataset.i],
        assigneeId: $('select', el).value,
        dueInDays: Number($('input[name=days]', el).value) || 0,
      }));
      if (!steps.length) return closeModal();
      try {
        await api('createFollowups', taskId, steps);
        closeModal();
        toast(`${steps.length} follow-up task${steps.length === 1 ? '' : 's'} created with reminders`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  };
}

// ============================================================ actions
const actions = {
  nav: (el) => { S.page = el.dataset.page; S.notifOpen = false; render(); },
  'open-task': (el) => openTask(el.dataset.id),
  'open-member': (el, e) => {
    e.preventDefault();
    if (el.dataset.id === me().id) S.page = 'profile';
    else { S.page = 'member'; S.memberId = el.dataset.id; }
    closeDrawer();
    render();
  },
  'close-drawer': closeDrawer,
  'new-task': (el) => taskForm(null, { assignee: el.dataset.assignee, team: el.dataset.team }),
  'edit-task': (el) => taskForm(task(el.dataset.id)),
  'delete-task': async (el) => {
    const t = task(el.dataset.id);
    if (await confirmModal('Delete task?', `"${t.title}" and its time logs will be removed.`, 'Delete', true)) {
      await run(() => api('deleteTask', t.id), 'Task deleted');
      closeDrawer();
    }
  },
  'toggle-timer': (el) => run(() => api('toggleTimer', el.dataset.id)),
  'set-status': (el) => run(() => api('updateTask', el.dataset.id, { status: el.dataset.status })),
  'subtask-del': (el) => {
    const t = task(el.dataset.id);
    run(() => api('updateTask', t.id, { subtasks: t.subtasks.filter((s) => s.id !== el.dataset.sub) }));
  },
  'reminder-del': (el) => {
    const t = task(el.dataset.id);
    run(() => api('updateTask', t.id, { reminders: t.reminders.filter((r) => r.id !== el.dataset.rem) }));
  },
  'sync-task': (el) => run(() => api('syncTask', el.dataset.id), 'Synced with GitHub'),
  'sync-all': async () => {
    const n = await run(() => api('syncAll'));
    toast(n ? `Synced ${n} GitHub-linked task${n === 1 ? '' : 's'}` : 'No open GitHub-linked tasks to sync', 'success');
  },
  'gh-unlink': (el) => run(() => api('updateTask', el.dataset.id, { github: null, progressMode: 'manual' })),
  'gh-connect': async () => {
    const token = $('#gh-token').value.trim();
    if (!token) return toast('Paste a token first', 'error');
    await run(() => api('connectGithub', token), 'GitHub connected');
    delete S.gh[me().id];
    S.myRepos = null;
  },
  'gh-disconnect': async () => {
    if (await confirmModal('Disconnect GitHub?', 'Your token is removed from this computer. Linked tasks will sync using public access only.', 'Disconnect', true)) {
      run(() => api('disconnectGithub'), 'GitHub disconnected');
      S.myRepos = null;
    }
  },
  'gh-refresh': (el) => { loadGithubPanel(el.dataset.id, true); const p = $(`[data-gh-panel="${el.dataset.id}"]`); if (p) p.innerHTML = ghPanelInner(el.dataset.id); },
  'gh-set-login': (el) => {
    const login = $('#gh-login').value.trim();
    if (login) run(() => api('setGithubLogin', el.dataset.id, login), 'GitHub username linked');
  },
  'task-scope': (el) => { S.tasks.scope = el.dataset.v; S.tasks.person = ''; render(); },
  'task-status': (el) => { S.tasks.status = el.dataset.v; render(); },
  'task-view': (el) => { S.tasks.view = el.dataset.v; render(); },
  'cal-move': (el) => {
    const v = Number(el.dataset.v);
    if (v === 0) S.cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
    else {
      const d = new Date(S.cal.y, S.cal.m + v, 1);
      S.cal = { y: d.getFullYear(), m: d.getMonth() };
    }
    render();
  },
  'toggle-notifs': () => {
    S.notifOpen = !S.notifOpen;
    render();
  },
  'notifs-read': () => run(() => api('markNotificationsRead')),
  'notif-open': (el) => {
    api('markNotificationsRead', [el.dataset.id]);
    S.notifOpen = false;
    if (el.dataset.task && task(el.dataset.task)) openTask(el.dataset.task);
    render();
  },
  'new-person': (el) => personForm(null, el.dataset.team),
  'edit-person': (el) => personForm(user(el.dataset.id)),
  'new-team': () => teamForm(),
  'edit-team': (el) => teamForm(team(el.dataset.id)),
  'event-flow': (el) => eventFlow(el.dataset.id, { askFirst: false }),
  'clear-ai-key': () => run(() => api('updateSettings', { anthropicKey: '' }), 'API key removed'),
  logout: async () => {
    await api('logout');
    S.page = 'dashboard';
    S.gh = {};
    S.myRepos = null;
    closeDrawer();
    refresh();
  },
};

const changes = {
  'task-person': (el) => { S.tasks.person = el.value; render(); },
  'progress-mode': (el) => run(() => api('updateTask', el.dataset.id, { progressMode: el.value })),
  progress: (el) => run(() => api('updateTask', el.dataset.id, { progress: Number(el.value) })),
  subtask: (el) => {
    const t = task(el.dataset.id);
    run(() => api('updateTask', t.id, { subtasks: t.subtasks.map((s) => (s.id === el.dataset.sub ? { ...s, done: el.checked } : s)) }));
  },
};

const forms = {
  'subtask-add': (form, t) => {
    const text = form.text.value.trim();
    if (!text) return;
    const patch = { subtasks: [...t.subtasks, { text, done: false }] };
    if (!t.subtasks.length && t.progressMode === 'manual' && t.progress === 0) patch.progressMode = 'checklist';
    return api('updateTask', t.id, patch);
  },
  'log-time': (form, t) => api('logTime', t.id, { minutes: form.minutes.value, note: form.note.value }).then(() => toast('Time logged', 'success')),
  'gh-link': (form, t) => api('updateTask', t.id, { github: { repo: form.repo.value, type: form.type.value, number: form.number.value }, progressMode: 'github' }).then(() => toast('Linked – syncing with GitHub…', 'success')),
  'reminder-add': (form, t) => api('updateTask', t.id, { reminders: [...t.reminders, { at: fromLocalInput(form.at.value), text: form.text.value }] }).then(() => toast('Reminder added', 'success')),
  comment: (form, t) => form.text.value.trim() && api('addComment', t.id, form.text.value),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (S.notifOpen && !e.target.closest('.notif-panel') && !e.target.closest('[data-action=toggle-notifs]')) {
    S.notifOpen = false;
    $('.notif-panel')?.remove();
  }
  if (!el || el.disabled) return;
  if (el.tagName === 'A' && !el.target) e.preventDefault();
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'task-search') {
    S.tasks.q = e.target.value;
    S.tasks._focusSearch = true;
    render();
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.dataset.form) {
    e.preventDefault();
    const t = task(form.dataset.id);
    try {
      await forms[form.dataset.form](form, t);
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  if (form.id === 'profile-form') {
    e.preventDefault();
    run(() => api('updateUser', me().id, Object.fromEntries(new FormData(form))), 'Profile saved');
  }
  if (form.id === 'password-form') {
    e.preventDefault();
    await run(() => api('changePassword', Object.fromEntries(new FormData(form))), 'Password changed');
    form.reset();
  }
  if (form.id === 'settings-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      orgName: fd.get('orgName'),
      reminderLeadHours: fd.get('reminderLeadHours'),
      githubSyncMinutes: fd.get('githubSyncMinutes'),
      keepRunningInTray: fd.get('keepRunningInTray') === 'on',
    };
    if (fd.get('anthropicKey')) patch.anthropicKey = fd.get('anthropicKey');
    run(() => api('updateSettings', patch), 'Settings saved');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#modal-root').innerHTML) closeModal();
    else if (S.drawerTaskId) closeDrawer();
    else if (S.notifOpen) { S.notifOpen = false; render(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && S.data && !$('#modal-root').innerHTML) {
    e.preventDefault();
    taskForm();
  }
});

// Tooltips for any element with data-tip.
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  const tip = $('#tooltip');
  if (!el || !el.dataset.tip) return tip.classList.remove('show');
  tip.textContent = el.dataset.tip;
  tip.classList.add('show');
});
document.addEventListener('mousemove', (e) => {
  const tip = $('#tooltip');
  if (!tip.classList.contains('show')) return;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
});

// Live clocks for running timers.
setInterval(() => {
  for (const el of $$('[data-clock]')) el.textContent = fmtClock(Date.now() - Date.parse(el.dataset.clock));
  for (const el of $$('[data-total-start]')) el.textContent = fmtClock(Number(el.dataset.totalBase) + (Date.now() - Number(el.dataset.totalStart)));
}, 1000);

// Re-render once a minute so relative times / deadline chips stay fresh.
setInterval(() => { if (S.data && !$('#modal-root').innerHTML) render(); }, 60000);

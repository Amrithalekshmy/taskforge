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

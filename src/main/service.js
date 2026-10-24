// Business logic + role-based permissions. Every IPC call ends up here and is
// checked against the logged-in user, so the renderer cannot bypass the rules.
const Store = require('./store');
const { hashPassword, verifyPassword, encryptSecret, decryptSecret } = require('./auth');
const github = require('./github');
const ai = require('./ai');

const ROLES = ['chair', 'head', 'member'];
const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TEAM_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

class PermissionError extends Error {}

class Service {
  constructor(store, { onNotify = () => {}, onChange = () => {}, onTaskCompleted = () => {} } = {}) {
    this.store = store;
    this.onNotify = onNotify;
    this.onChange = onChange;
    this.onTaskCompleted = onTaskCompleted;
    this.profileCache = new Map();
  }

  // ---------- helpers ----------
  commit() {
    this.store.save();
    this.onChange();
  }

  notify(userId, text, opts) {
    if (!userId) return;
    const n = this.store.notify(userId, text, opts);
    this.onNotify(n);
  }

  me() {
    const u = this.store.user(this.store.data.session.userId);
    if (!u) throw new PermissionError('Not logged in');
    return u;
  }

  teamsHeadedBy(user) {
    return this.store.teams.filter((t) => t.headId === user.id).map((t) => t.id);
  }

  isHeadOf(user, teamId) {
    return !!teamId && this.store.team(teamId)?.headId === user.id;
  }

  // Users whose work `viewer` may see (and assign to).
  managedUserIds(viewer) {
    if (viewer.role === 'chair') return new Set(this.store.users.map((u) => u.id));
    if (viewer.role === 'head') {
      const teams = new Set(this.teamsHeadedBy(viewer));
      return new Set([viewer.id, ...this.store.users.filter((u) => teams.has(u.teamId)).map((u) => u.id)]);
    }
    return new Set([viewer.id]);
  }

  canView(viewer, task) {
    if (viewer.role === 'chair') return true;
    if (task.assigneeId === viewer.id || task.assignedById === viewer.id) return true;
    if (viewer.role === 'head') {
      return this.isHeadOf(viewer, task.teamId) || this.managedUserIds(viewer).has(task.assigneeId);
    }
    return false;
  }

  canManage(viewer, task) {
    if (viewer.role === 'chair' || task.assignedById === viewer.id) return true;
    // Work handed to you from above is yours to do, not to edit or delete.
    if (task.assigneeId === viewer.id) return false;
    return viewer.role === 'head' && (this.isHeadOf(viewer, task.teamId) || this.managedUserIds(viewer).has(task.assigneeId));
  }

  canWork(viewer, task) {
    return task.assigneeId === viewer.id || this.canManage(viewer, task);
  }

  publicUser(u) {
    const { passwordHash, salt, githubToken, ...rest } = u;
    return { ...rest, githubConnected: !!githubToken };
  }

  githubTokenFor(...userIds) {
    for (const id of userIds) {
      const u = this.store.user(id);
      if (u?.githubToken) return decryptSecret(u.githubToken);
    }
    const anyone = this.store.users.find((u) => u.githubToken && u.role === 'chair') || this.store.users.find((u) => u.githubToken);
    return anyone ? decryptSecret(anyone.githubToken) : null;
  }

  // ---------- auth ----------
  status() {
    const needsSetup = this.store.users.length === 0;
    const u = this.store.user(this.store.data.session.userId);
    return { needsSetup, user: u ? this.publicUser(u) : null };
  }

  setup({ name, username, email, password, orgName }) {
    if (this.store.users.length) throw new PermissionError('Already set up');
    const u = this._newUser({ name, username, email, password, role: 'chair' });
    this.store.data.orgName = orgName?.trim() || 'My Organisation';
    this.store.data.session.userId = u.id;
    this.store.log(u.id, `${u.name} set up the workspace as Chairperson`);
    this.commit();
    return this.publicUser(u);
  }

  login({ username, password }) {
    const u = this.store.users.find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
    if (!u || !verifyPassword(password, u.salt, u.passwordHash)) throw new PermissionError('Wrong username or password');
    this.store.data.session.userId = u.id;
    u.lastLoginAt = new Date().toISOString();
    this.commit();
    return this.publicUser(u);
  }

  logout() {
    this.store.data.session.userId = null;
    this.commit();
  }

  changePassword({ current, next }) {
    const me = this.me();
    if (!verifyPassword(current, me.salt, me.passwordHash)) throw new PermissionError('Current password is wrong');
    if (!next || next.length < 6) throw new Error('New password must be at least 6 characters');
    Object.assign(me, (({ salt, hash }) => ({ salt, passwordHash: hash }))(hashPassword(next)));
    this.commit();
  }

  _newUser({ name, username, email, password, role, teamId = null, title = '' }) {
    if (!name?.trim() || !username?.trim()) throw new Error('Name and username are required');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (this.store.users.some((x) => x.username.toLowerCase() === username.trim().toLowerCase())) {
      throw new Error('That username is taken');
    }
    const { salt, hash } = hashPassword(password);
    const u = {
      id: Store.id(), name: name.trim(), username: username.trim(), email: email?.trim() || '', title: title?.trim() || '',
      role, teamId, salt, passwordHash: hash, githubToken: null, githubLogin: null,
      createdAt: new Date().toISOString(), lastLoginAt: null,
    };
    this.store.users.push(u);
    return u;
  }

  // ---------- bootstrap (everything the UI needs) ----------
  bootstrap() {
    const me = this.me();
    const managed = this.managedUserIds(me);
    const myTeam = me.teamId;
    const visibleUsers = this.store.users.filter((u) =>
      managed.has(u.id) || u.role === 'chair' || (myTeam && u.teamId === myTeam) ||
      (myTeam && this.store.team(myTeam)?.headId === u.id));
    const s = this.store.settings;
    return {
      orgName: this.store.data.orgName,
      me: this.publicUser(me),
      users: visibleUsers.map((u) => this.publicUser(u)),
      managedUserIds: [...managed],
      teams: this.store.teams,
      tasks: this.store.tasks.filter((t) => this.canView(me, t)),
      notifications: this.store.notifications.filter((n) => n.userId === me.id).slice(0, 200),
      activity: this.store.data.activity.filter((a) => managed.has(a.userId) || a.userId === me.id).slice(0, 60),
      settings: {
        githubSyncMinutes: s.githubSyncMinutes,
        reminderLeadHours: s.reminderLeadHours,
        keepRunningInTray: s.keepRunningInTray,
        aiConfigured: !!decryptSecret(s.anthropicKey) || !!process.env.ANTHROPIC_API_KEY,
      },
    };
  }
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

module.exports = { Service, PermissionError };

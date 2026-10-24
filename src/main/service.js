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

  // ---------- users & teams ----------
  createUser(data) {
    const me = this.me();
    if (me.role === 'member') throw new PermissionError('Only heads and the chairperson can add people');
    let { role, teamId } = data;
    if (me.role === 'head') {
      role = 'member';
      if (!this.isHeadOf(me, teamId)) throw new PermissionError('Heads can only add people to their own team');
    }
    const u = this._newUser({ ...data, role, teamId: teamId || null });
    this.store.log(me.id, `${me.name} added ${u.name} as ${role}`);
    this.notify(u.id, `Welcome to ${this.store.data.orgName}! ${me.name} created your account.`);
    this.commit();
    return this.publicUser(u);
  }

  updateUser(id, patch) {
    const me = this.me();
    const u = this.store.user(id);
    if (!u) throw new Error('User not found');
    const self = me.id === id;
    if (!self && me.role !== 'chair' && !(me.role === 'head' && this.managedUserIds(me).has(id))) {
      throw new PermissionError('Not allowed');
    }
    for (const k of ['name', 'email', 'title']) if (k in patch) u[k] = String(patch[k] || '').trim();
    if (me.role === 'chair' && !self) {
      if ('role' in patch && ROLES.includes(patch.role)) u.role = patch.role;
      if ('teamId' in patch) u.teamId = patch.teamId || null;
    }
    if (me.role === 'chair' && 'password' in patch && patch.password) {
      Object.assign(u, (({ salt, hash }) => ({ salt, passwordHash: hash }))(hashPassword(patch.password)));
    }
    this.commit();
    return this.publicUser(u);
  }

  deleteUser(id) {
    const me = this.me();
    if (me.role !== 'chair' || me.id === id) throw new PermissionError('Only the chairperson can remove other people');
    const u = this.store.user(id);
    this.store.data.users = this.store.users.filter((x) => x.id !== id);
    for (const t of this.store.teams) if (t.headId === id) t.headId = null;
    for (const t of this.store.tasks) if (t.assigneeId === id) t.assigneeId = null;
    this.store.log(me.id, `${me.name} removed ${u?.name}`);
    this.commit();
  }

  createTeam({ name, headId, description }) {
    const me = this.me();
    if (me.role !== 'chair') throw new PermissionError('Only the chairperson can create teams');
    if (!name?.trim()) throw new Error('Team name is required');
    const team = {
      id: Store.id(), name: name.trim(), description: description?.trim() || '', headId: headId || null,
      color: TEAM_COLORS[this.store.teams.length % TEAM_COLORS.length], createdAt: new Date().toISOString(),
    };
    this.store.teams.push(team);
    this._promoteHead(headId, team.id);
    this.store.log(me.id, `${me.name} created team ${team.name}`);
    this.commit();
    return team;
  }

  updateTeam(id, patch) {
    const me = this.me();
    if (me.role !== 'chair') throw new PermissionError('Only the chairperson can edit teams');
    const t = this.store.team(id);
    if (!t) throw new Error('Team not found');
    for (const k of ['name', 'description']) if (k in patch) t[k] = String(patch[k] || '').trim();
    if ('headId' in patch && patch.headId !== t.headId) {
      t.headId = patch.headId || null;
      this._promoteHead(t.headId, t.id);
    }
    this.commit();
    return t;
  }

  _promoteHead(userId, teamId) {
    const u = this.store.user(userId);
    if (!u) return;
    if (u.role === 'member') u.role = 'head';
    if (!u.teamId) u.teamId = teamId;
    this.notify(u.id, `You are now the head of ${this.store.team(teamId).name}`);
  }

  deleteTeam(id) {
    const me = this.me();
    if (me.role !== 'chair') throw new PermissionError('Only the chairperson can delete teams');
    this.store.data.teams = this.store.teams.filter((t) => t.id !== id);
    for (const u of this.store.users) if (u.teamId === id) u.teamId = null;
    this.commit();
  }

  // ---------- tasks ----------
  createTask(data) {
    const me = this.me();
    const assigneeId = data.assigneeId || me.id;
    if (!this.managedUserIds(me).has(assigneeId)) throw new PermissionError('You cannot assign tasks to that person');
    if (!data.title?.trim()) throw new Error('Title is required');
    const assignee = this.store.user(assigneeId);
    const now = new Date().toISOString();
    const task = {
      id: Store.id(),
      title: data.title.trim(),
      description: data.description?.trim() || '',
      assigneeId,
      assignedById: me.id,
      teamId: data.teamId || assignee?.teamId || this.teamsHeadedBy(assignee || me)[0] || null,
      priority: PRIORITIES.includes(data.priority) ? data.priority : 'medium',
      status: 'todo',
      progress: 0,
      progressMode: data.github?.repo ? 'github' : (data.subtasks?.length ? 'checklist' : 'manual'),
      category: data.category || 'general',
      tags: (data.tags || []).map((t) => String(t).trim()).filter(Boolean),
      deadline: data.deadline || null,
      estimateHours: Number(data.estimateHours) || null,
      subtasks: (data.subtasks || []).filter((s) => s.text?.trim()).map((s) => ({ id: Store.id(), text: s.text.trim(), done: false })),
      github: null,
      timeLogs: [],
      timer: null,
      reminders: (data.reminders || []).filter((r) => r.at).map((r) => ({ id: Store.id(), at: r.at, text: r.text || '', sent: false })),
      comments: [],
      parentTaskId: data.parentTaskId || null,
      event: data.event || null,
      deadlineReminded: false,
      overdueNotified: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    if (data.github?.repo) task.github = this._normaliseLink(data.github);
    this.store.tasks.push(task);
    if (assigneeId !== me.id) {
      this.notify(assigneeId, `${me.name} assigned you "${task.title}"${task.deadline ? ` – due ${new Date(task.deadline).toLocaleString()}` : ''}`, { taskId: task.id, kind: 'assign' });
    }
    this.store.log(me.id, `${me.name} created "${task.title}" for ${assignee?.name || 'themself'}`, task.id);
    this.commit();
    if (task.github) this.syncTask(task.id).catch(() => {});
    return task;
  }

  _normaliseLink(link) {
    const repo = github.parseRepo(link.repo);
    if (!repo) throw new Error('GitHub repo must look like owner/repo');
    if (!['issue', 'pr', 'milestone'].includes(link.type)) throw new Error('Pick issue, pull request or milestone');
    if (!Number(link.number)) throw new Error('Enter the issue / PR / milestone number');
    return { repo, type: link.type, number: Number(link.number), state: null, info: null, lastSync: null, error: null };
  }

  updateTask(id, patch) {
    const me = this.me();
    const t = this.store.task(id);
    if (!t) throw new Error('Task not found');
    if (!this.canWork(me, t)) throw new PermissionError('Not allowed');
    const manage = this.canManage(me, t);

    if (manage) {
      for (const k of ['title', 'description']) if (k in patch) t[k] = String(patch[k] || '').trim();
      if ('priority' in patch && PRIORITIES.includes(patch.priority)) t.priority = patch.priority;
      if ('category' in patch) t.category = patch.category;
      if ('tags' in patch) t.tags = patch.tags;
      if ('estimateHours' in patch) t.estimateHours = Number(patch.estimateHours) || null;
      if ('deadline' in patch && patch.deadline !== t.deadline) {
        t.deadline = patch.deadline || null;
        t.deadlineReminded = false;
        t.overdueNotified = false;
        if (t.assigneeId !== me.id && t.deadline) {
          this.notify(t.assigneeId, `Deadline for "${t.title}" set to ${new Date(t.deadline).toLocaleString()}`, { taskId: t.id, kind: 'deadline' });
        }
      }
      if ('assigneeId' in patch && patch.assigneeId !== t.assigneeId) {
        if (!this.managedUserIds(me).has(patch.assigneeId)) throw new PermissionError('Cannot assign to that person');
        t.assigneeId = patch.assigneeId;
        t.teamId = this.store.user(patch.assigneeId)?.teamId || t.teamId;
        this.notify(t.assigneeId, `${me.name} assigned you "${t.title}"`, { taskId: t.id, kind: 'assign' });
      }
    }

    if ('subtasks' in patch) t.subtasks = patch.subtasks.map((s) => ({ id: s.id || Store.id(), text: String(s.text).trim(), done: !!s.done })).filter((s) => s.text);
    if ('progressMode' in patch && ['manual', 'checklist', 'github'].includes(patch.progressMode)) t.progressMode = patch.progressMode;
    if ('progress' in patch && t.progressMode === 'manual') t.progress = clamp(patch.progress);
    if (t.progressMode === 'checklist') {
      t.progress = t.subtasks.length ? Math.round((t.subtasks.filter((s) => s.done).length / t.subtasks.length) * 100) : 0;
    }
    if ('reminders' in patch) {
      t.reminders = patch.reminders.filter((r) => r.at).map((r) => ({ id: r.id || Store.id(), at: r.at, text: r.text || '', sent: r.sent && r.at === t.reminders.find((x) => x.id === r.id)?.at }));
    }
    if ('github' in patch) t.github = patch.github?.repo ? this._normaliseLink(patch.github) : null;

    if ('status' in patch && STATUSES.includes(patch.status) && patch.status !== t.status) {
      if (patch.status === 'done') {
        this._complete(t, me, 'manual');
      } else {
        t.status = patch.status;
        t.completedAt = null;
      }
    } else if (t.status === 'todo' && t.progress > 0) {
      t.status = 'in_progress';
    }

    t.updatedAt = new Date().toISOString();
    this.commit();
    if ('github' in patch && t.github) this.syncTask(t.id).catch(() => {});
    return t;
  }

  _complete(t, actor, via) {
    t.status = 'done';
    t.progress = 100;
    t.completedAt = new Date().toISOString();
    this._stopTimer(t);
    const who = actor ? actor.name : 'GitHub';
    const viaText = via === 'github' ? ' (auto-detected from GitHub)' : '';
    const recipients = new Set([t.assignedById, t.assigneeId, this.store.team(t.teamId)?.headId]);
    recipients.delete(actor?.id);
    for (const uid of recipients) {
      this.notify(uid, `✅ "${t.title}" was completed by ${this.store.user(t.assigneeId)?.name || who}${viaText}`, { taskId: t.id, kind: 'done' });
    }
    this.store.log(actor?.id || t.assigneeId, `"${t.title}" completed${viaText}`, t.id);
    this.onTaskCompleted(t, { looksLikeEvent: ai.looksLikeEvent(t) });
  }

  deleteTask(id) {
    const me = this.me();
    const t = this.store.task(id);
    if (!t) return;
    if (!this.canManage(me, t)) throw new PermissionError('Only the person who assigned it (or a head/chair) can delete this');
    this.store.data.tasks = this.store.tasks.filter((x) => x.id !== id);
    this.store.log(me.id, `${me.name} deleted "${t.title}"`);
    this.commit();
  }

  addComment(id, text) {
    const me = this.me();
    const t = this.store.task(id);
    if (!t || !this.canView(me, t)) throw new PermissionError('Not allowed');
    if (!text?.trim()) return t;
    t.comments.push({ id: Store.id(), userId: me.id, text: text.trim(), at: new Date().toISOString() });
    for (const uid of new Set([t.assigneeId, t.assignedById])) {
      if (uid !== me.id) this.notify(uid, `💬 ${me.name} commented on "${t.title}"`, { taskId: t.id, kind: 'comment' });
    }
    this.commit();
    return t;
  }
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

module.exports = { Service, PermissionError };

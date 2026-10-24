// Tiny JSON-file database. All reads/writes go through the main process, so a
// single in-memory copy is the source of truth and is flushed atomically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = {
  version: 1,
  users: [],
  teams: [],
  tasks: [],
  notifications: [],
  activity: [],
  settings: {
    githubSyncMinutes: 5,
    reminderLeadHours: 24,
    anthropicKey: null, // encrypted with safeStorage when available
    keepRunningInTray: true,
    chairCode: null, // { salt, hash } – secret needed to sign up as Chairperson
    headCode: null, // { salt, hash } – secret needed to sign up as a Head
  },
  session: { userId: null },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'taskforge-db.json');
    this.data = structuredClone(EMPTY);
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...structuredClone(EMPTY), ...parsed };
      this.data.settings = { ...EMPTY.settings, ...(parsed.settings || {}) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep a copy of a corrupt file instead of silently overwriting it.
        try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch {}
      }
      this.save();
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  static id() {
    return crypto.randomUUID();
  }

  get users() { return this.data.users; }
  get teams() { return this.data.teams; }
  get tasks() { return this.data.tasks; }
  get notifications() { return this.data.notifications; }
  get settings() { return this.data.settings; }

  user(id) { return this.data.users.find((u) => u.id === id); }
  team(id) { return this.data.teams.find((t) => t.id === id); }
  task(id) { return this.data.tasks.find((t) => t.id === id); }

  log(userId, text, taskId = null) {
    this.data.activity.unshift({ id: Store.id(), userId, text, taskId, at: new Date().toISOString() });
    this.data.activity.length = Math.min(this.data.activity.length, 500);
  }

  notify(userId, text, { taskId = null, kind = 'info' } = {}) {
    const n = { id: Store.id(), userId, text, taskId, kind, at: new Date().toISOString(), read: false };
    this.data.notifications.unshift(n);
    this.data.notifications.length = Math.min(this.data.notifications.length, 1000);
    return n;
  }
}

module.exports = Store;

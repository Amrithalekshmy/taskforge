const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const Store = require('./src/main/store');
const { Service } = require('./src/main/service');
const { iconPng } = require('./src/main/icon');

app.setAppUserModelId('com.taskforge.app');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let quitting = false;
let store;
let service;
let icon;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let changeTimer = null;
function dataChanged() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => send('data-changed'), 50);
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function desktopNotify(n) {
  if (n.userId !== store.data.session.userId) return;
  send('notification', n);
  if (!Notification.isSupported()) return;
  const note = new Notification({ title: 'TaskForge', body: n.text, icon });
  note.on('click', () => {
    showWindow();
    if (n.taskId) send('open-task', n.taskId);
  });
  note.show();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0d0d0d',
    title: 'TaskForge',
    icon,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  // External links (GitHub, sources) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    if (!quitting && store.settings.keepRunningInTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromBuffer(iconPng(32)));
  } catch {
    tray = null; // Some Linux desktops have no tray; the app still works.
    return;
  }
  tray.setToolTip('TaskForge');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TaskForge', click: showWindow },
    { label: 'Sync GitHub now', click: () => service.syncAll().catch(() => {}) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// Methods the renderer may call. Everything else on Service is private.
const API = [
  'status', 'setup', 'login', 'logout', 'changePassword', 'bootstrap',
  'createUser', 'updateUser', 'deleteUser',
  'createTeam', 'updateTeam', 'deleteTeam',
  'createTask', 'updateTask', 'deleteTask', 'addComment', 'toggleTimer', 'logTime',
  'connectGithub', 'disconnectGithub', 'setGithubLogin', 'githubProfile', 'githubRepoItems', 'githubMyRepos',
  'syncTask', 'syncAll',
  'markNotificationsRead', 'suggestFollowups', 'createFollowups', 'updateSettings',
];

function startScheduler() {
  service.checkReminders();
  setInterval(() => service.checkReminders(), 30 * 1000);

  let lastSync = 0;
  const tick = async () => {
    if (Date.now() - lastSync >= store.settings.githubSyncMinutes * 60000) {
      lastSync = Date.now();
      try { await service.syncAll(); } catch {}
    }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 60 * 1000);
}

app.whenReady().then(() => {
  icon = nativeImage.createFromBuffer(iconPng(256));
  store = new Store(process.env.TASKFORGE_DATA_DIR || app.getPath('userData'));
  service = new Service(store, {
    onNotify: desktopNotify,
    onChange: dataChanged,
    onTaskCompleted: (task, meta) => {
      const me = store.user(store.data.session.userId);
      if (me && service.canView(me, task)) send('task-completed', { taskId: task.id, ...meta });
    },
  });

  ipcMain.handle('api', async (_e, method, args = []) => {
    if (!API.includes(method)) return { ok: false, error: `Unknown method ${method}` };
    try {
      return { ok: true, data: await service[method](...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  createWindow();
  createTray();
  startScheduler();
});

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (!tray || !store.settings.keepRunningInTray) app.quit();
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskforge', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, args),
  on: (channel, fn) => {
    const allowed = ['data-changed', 'notification', 'task-completed', 'open-task'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

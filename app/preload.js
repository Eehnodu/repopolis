const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('repopolis', {
  home: () => ipcRenderer.invoke('home'),
  pickProject: () => ipcRenderer.invoke('pick'),
  openProject: (root) => ipcRenderer.invoke('open-project', root),
  recent: () => ipcRenderer.invoke('recent'),
  forget: (root) => ipcRenderer.invoke('forget', root),
  openFile: (rel) => ipcRenderer.invoke('open-file', rel),
  revealFile: (rel) => ipcRenderer.invoke('reveal-file', rel),
  readFile: (rel) => ipcRenderer.invoke('read-file', rel),
  pathOf: (file) => webUtils.getPathForFile(file),
  onStatus: (cb) => ipcRenderer.on('status', (_, s) => cb(s)),
  setWindow: (cmd) => ipcRenderer.invoke('window', cmd),
  showMain: () => ipcRenderer.invoke('show-main'),
  focusFile: (rel) => ipcRenderer.invoke('focus-file', rel),
  onFocusFile: (cb) => ipcRenderer.on('focus-file', (_, rel) => cb(rel)),
  mini: (cmd) => ipcRenderer.invoke('mini', cmd),
  getNotify: () => ipcRenderer.invoke('notify-get'),
  setNotify: (on) => ipcRenderer.invoke('notify-set', on),
  windowState: () => ipcRenderer.invoke('window-state'),
});

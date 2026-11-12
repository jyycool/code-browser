// The only bridge between the shell UI and the main process.
const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld("shellApi", {
  info: () => ipcRenderer.invoke("app:info"),
  start: () => ipcRenderer.invoke("session:start"),
  stop: () => ipcRenderer.invoke("session:stop"),
  setBounds: (r) => ipcRenderer.send("session:bounds", r),
  nav: (action) => ipcRenderer.send("session:nav", action),
  focusBrowser: () => ipcRenderer.send("session:focus"),
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleMaximize: () => ipcRenderer.send("win:toggle-maximize"),
  close: () => ipcRenderer.send("win:close"),
  onPhase: listen("session:phase"),
  onSteps: listen("session:steps"),
  onStatus: listen("session:status"),
  onTitle: listen("session:title"),
  onToast: listen("session:toast"),
  onMaximized: listen("win:maximized"),
});

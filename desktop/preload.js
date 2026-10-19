/* eslint-disable @typescript-eslint/no-require-imports -- Electron preload scripts are CommonJS. */
// The only bridge between the web UI and the Mac app: Dock badge, window focus, and the app lock.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clarityDesktop", {
  setBadge: (count) => ipcRenderer.send("clarity:badge", Number(count) || 0),
  focus: () => ipcRenderer.send("clarity:focus"),
  lock: () => ipcRenderer.send("clarity:lock"),
  getPrefs: () => ipcRenderer.invoke("clarity:prefs"),
  setPrefs: (next) =>
    ipcRenderer.invoke("clarity:set-prefs", {
      lockAfterMinutes: Number(next && next.lockAfterMinutes),
      lockOnSleep: Boolean(next && next.lockOnSleep),
    }),
  unlockWithTouchId: () => ipcRenderer.invoke("clarity:touch-id"),
});

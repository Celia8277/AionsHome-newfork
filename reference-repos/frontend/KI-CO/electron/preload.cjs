const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kicoDesktop", {
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  getAppVersion: () => ipcRenderer.invoke("kico:get-app-version"),
});

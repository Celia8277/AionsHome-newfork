const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const devServerUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL || "";

function resolveWindowIcon() {
  const icoPath = path.join(appRoot, "build", "icon.ico");
  if (process.platform === "win32" && fs.existsSync(icoPath)) return icoPath;
  return path.join(appRoot, "public", "pwa-icon-512.png");
}

function isSafeAppUrl(url) {
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  return url.startsWith("file://");
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    show: false,
    title: "KI-CO Cottage",
    backgroundColor: "#15110e",
    icon: resolveWindowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: "persist:kico-cottage",
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isSafeAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(appRoot, "dist", "index.html"));
  }

  return win;
}

app.setAppUserModelId("com.kisera.kico");

ipcMain.handle("kico:get-app-version", () => app.getVersion());

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

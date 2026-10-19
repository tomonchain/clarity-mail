/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main process entry is CommonJS. */
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
  systemPreferences,
} = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PREFERRED_PORT = 47317;
const SESSION_COOKIE = "sorted_session";
const ALLOWED_ENV = ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "MISTRAL_API_KEY", "MISTRAL_MODEL"];
const DEFAULT_PREFS = { lockAfterMinutes: 15, lockOnSleep: true };
const LOCK_CHOICES = [0, 5, 15, 30, 60];

app.setName("Clarity Mail");

let server = null;
let mainWindow = null;
let quitting = false;
let serverLog = "";
let origin = null;
let serverPort = null;
// Known only to this process and the server it starts: lets Touch ID open a session.
const unlockSecret = crypto.randomBytes(32).toString("hex");
let prefs = { ...DEFAULT_PREFS };

function resource(...parts) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...parts);
  return path.join(__dirname, "staging", ...parts);
}

function serverRoot() {
  const nested = resource("server", "app");
  if (app.isPackaged || fs.existsSync(path.join(nested, "server.js"))) return nested;
  return resource("server");
}

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

function readClarityEnv() {
  const file = userFile("clarity.env");
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!ALLOWED_ENV.includes(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/* ---------- Mailbox key, kept in the macOS Keychain ---------- */

class KeychainDenied extends Error {}

/**
 * The master key is random, sealed by the Keychain ("Clarity Mail Safe
 * Storage") and stored sealed in vault.key. It is never written in clear and
 * never put in the environment: the server reads it from its stdin.
 */
function readMasterKey() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new KeychainDenied("The macOS Keychain is not available.");
  }
  const file = userFile("vault.key");
  if (fs.existsSync(file)) {
    try {
      const key = safeStorage.decryptString(fs.readFileSync(file)).trim();
      if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("bad key");
      return key;
    } catch {
      // Never replace an existing key: the mailbox can only be read with it.
      throw new KeychainDenied("Clarity Mail could not read its key from the Keychain.");
    }
  }
  const key = crypto.randomBytes(32).toString("hex");
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, safeStorage.encryptString(key), { mode: 0o600 });
  fs.renameSync(temp, file);
  return key;
}

async function masterKeyWithRetry() {
  for (;;) {
    try {
      return readMasterKey();
    } catch (err) {
      if (!(err instanceof KeychainDenied)) throw err;
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Try Again", "Quit"],
        defaultId: 0,
        cancelId: 1,
        message: "Clarity Mail needs its key from the Keychain",
        detail: `${err.message}\n\nYour mail is encrypted on this Mac. When macOS asks, enter your Mac password and choose “Always Allow”.`,
      });
      if (response !== 0) return null;
    }
  }
}

/* ---------- Local server ---------- */

function appendLog(chunk) {
  const text = chunk.toString();
  serverLog = (serverLog + text).slice(-12000);
  try {
    fs.appendFileSync(userFile("server.log"), text, { mode: 0o600 });
  } catch {
    // The window can still open if the log file cannot be written.
  }
}

function rotateLog() {
  const file = userFile("server.log");
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) fs.renameSync(file, `${file}.1`);
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  } catch {
    // Logging is best effort.
  }
}

function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const fallback = net.createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port, masterKey) {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  rotateLog();
  const nodeBin = resource("bin", "node");
  const serverJs = path.join(serverRoot(), "server.js");
  if (!fs.existsSync(nodeBin) || !fs.existsSync(serverJs)) {
    throw new Error("The app is missing its mail server. Reinstall Clarity Mail.app.");
  }
  const binDir = resource("bin");
  const env = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: process.env.LANG || "en_US.UTF-8",
    PATH: `${binDir}${path.delimiter}/usr/bin:/bin`,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    SORTED_DATA_DIR: dataDir,
    CLARITY_DESKTOP: "1",
    CLARITY_KEY_STDIN: "1",
    ...readClarityEnv(),
  };
  server = spawn(nodeBin, [serverJs], {
    cwd: serverRoot(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  server.stdin.on("error", () => {});
  server.stdin.end(`${JSON.stringify({ key: masterKey, unlock: unlockSecret })}\n`);
  server.stdout.on("data", appendLog);
  server.stderr.on("data", appendLog);
  server.on("exit", (code) => {
    if (quitting || code === 0 || code === null) return;
    const tail = serverLog.trim().split("\n").slice(-12).join("\n");
    dialog.showErrorBox(
      "Clarity Mail stopped",
      `The local mail server exited (${code}).\n\n${tail}\n\nLog: ${userFile("server.log")}`,
    );
  });
}

function waitForServer(port) {
  const deadline = Date.now() + 90000;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (server && server.exitCode !== null) {
        reject(new Error("exited"));
        return;
      }
      const req = http.get({ hostname: "127.0.0.1", port, path: "/login", timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("timeout"));
      else setTimeout(attempt, 250);
    };
    attempt();
  });
}

/** A request from this process to the local server, outside the window's cookies. */
function callServer(method, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    if (!serverPort) {
      reject(new Error("The mail server is not running."));
      return;
    }
    const req = http.request(
      { hostname: "127.0.0.1", port: serverPort, path: pathname, method, headers, timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode || 0, body });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

/* ---------- Lock ---------- */

function loadPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(userFile("prefs.json"), "utf8"));
    return cleanPrefs(saved);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function cleanPrefs(input) {
  const minutes = Number(input && input.lockAfterMinutes);
  return {
    lockAfterMinutes: LOCK_CHOICES.includes(minutes) ? minutes : DEFAULT_PREFS.lockAfterMinutes,
    lockOnSleep: input && typeof input.lockOnSleep === "boolean" ? input.lockOnSleep : DEFAULT_PREFS.lockOnSleep,
  };
}

function savePrefs(next) {
  prefs = cleanPrefs(next);
  try {
    fs.writeFileSync(userFile("prefs.json"), JSON.stringify(prefs), { mode: 0o600 });
  } catch {
    // The choice lasts until quit.
  }
  return prefs;
}

function onUnlockedPage() {
  if (!mainWindow || mainWindow.isDestroyed() || !origin) return false;
  const url = mainWindow.webContents.getURL();
  if (!url.startsWith(origin)) return false;
  const pathname = new URL(url).pathname;
  return pathname !== "/login" && pathname !== "/setup";
}

let locking = false;

/** End the session on the server, drop the cookie, and show the lock screen. */
async function lockApp() {
  if (locking || !mainWindow || mainWindow.isDestroyed() || !origin) return;
  locking = true;
  try {
    const ses = mainWindow.webContents.session;
    const cookies = await ses.cookies.get({ url: origin, name: SESSION_COOKIE });
    for (const cookie of cookies) {
      await callServer("POST", "/api/auth/logout", { Cookie: `${SESSION_COOKIE}=${cookie.value}` }).catch(() => {});
    }
    await ses.cookies.remove(origin, SESSION_COOKIE);
    if (onUnlockedPage()) await mainWindow.loadURL(`${origin}/login?locked=1`);
    if (app.dock) app.dock.setBadge("");
  } finally {
    locking = false;
  }
}

function watchForLock() {
  powerMonitor.on("lock-screen", () => {
    if (prefs.lockOnSleep) void lockApp();
  });
  powerMonitor.on("suspend", () => {
    if (prefs.lockOnSleep) void lockApp();
  });
  setInterval(() => {
    if (prefs.lockAfterMinutes <= 0 || !onUnlockedPage()) return;
    if (powerMonitor.getSystemIdleTime() >= prefs.lockAfterMinutes * 60) void lockApp();
  }, 20000);
}

function touchIdAvailable() {
  try {
    return process.platform === "darwin" && systemPreferences.canPromptTouchID();
  } catch {
    return false;
  }
}

/** Only Clarity's own top-level page may use the bridge, never a mail frame or another site. */
function fromApp(event) {
  const frame = event.senderFrame;
  return Boolean(origin && frame && frame.parent === null && frame.url.startsWith(`${origin}/`));
}

async function unlockWithTouchId() {
  if (!touchIdAvailable()) return { ok: false, error: "Touch ID is not available on this Mac." };
  try {
    await systemPreferences.promptTouchID("unlock your mail");
  } catch {
    return { ok: false, error: "Touch ID did not unlock Clarity." };
  }
  const result = await callServer("POST", "/api/auth/unlock", { "x-clarity-unlock": unlockSecret }).catch(() => null);
  const token = result && result.status === 200 && result.body && result.body.token;
  if (!token) {
    const message = result && result.body && result.body.error;
    return { ok: false, error: message || "Clarity could not unlock. Use your password." };
  }
  // No expiry: the session cookie ends when the app quits.
  await mainWindow.webContents.session.cookies.set({
    url: origin,
    name: SESSION_COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
  });
  return { ok: true };
}

/* ---------- Window ---------- */

function loadBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(userFile("window.json"), "utf8"));
    if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved;
  } catch {
    // First launch has no saved window.
  }
  return { width: 1180, height: 820 };
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#16171b" : "#f4f5f7";
}

/** Links leave the app for the browser, and only web and mail links. */
function openExternally(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (["http:", "https:", "mailto:"].includes(parsed.protocol)) void shell.openExternal(parsed.toString());
}

function createWindow(port) {
  const bounds = loadBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Clarity Mail",
    backgroundColor: windowBackground(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true,
      // New mail and its notification must arrive while the window is hidden too.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  nativeTheme.removeAllListeners("updated");
  nativeTheme.on("updated", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
  });
  origin = `http://127.0.0.1:${port}`;
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(`${origin}/`);
  // The web UI reserves room for the traffic lights and marks drag regions when it sees this class.
  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents
      .executeJavaScript("document.documentElement.classList.add('desktop-app')")
      .catch(() => {});
    mainWindow.webContents.insertCSS(`
      body::before {
        content: "";
        position: fixed;
        z-index: 80;
        top: 0;
        left: 0;
        right: 0;
        height: 10px;
        -webkit-app-region: drag;
        pointer-events: none;
      }
    `).catch(() => {});
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${origin}/`) || url === origin) return;
    event.preventDefault();
    openExternally(url);
  });
  // A mail frame never navigates: its links open in the browser.
  mainWindow.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const url = details.url;
    if (url === "about:blank" || url === "about:srcdoc") return;
    details.preventDefault();
    openExternally(url);
  });
  mainWindow.on("close", () => {
    try {
      fs.writeFileSync(userFile("window.json"), JSON.stringify(mainWindow.getBounds()));
    } catch {
      // Ignore a failed bounds write.
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function hardenSessions() {
  const ses = session.defaultSession;
  const allowed = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const url = (details && details.requestingUrl) || "";
    callback(Boolean(origin && url.startsWith(origin) && allowed.has(permission)));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return Boolean(origin && requestingOrigin && requestingOrigin.startsWith(origin) && allowed.has(permission));
  });
  ses.on("will-download", (event) => event.preventDefault());
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: "deny" };
    });
  });
}

function installBridge() {
  ipcMain.on("clarity:badge", (event, count) => {
    if (!app.dock || !fromApp(event)) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    app.dock.setBadge(n > 0 ? (n > 99 ? "99+" : String(n)) : "");
  });
  ipcMain.on("clarity:focus", (event) => {
    if (!mainWindow || !fromApp(event)) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    app.focus({ steal: true });
    mainWindow.focus();
  });
  ipcMain.on("clarity:lock", (event) => {
    if (fromApp(event)) void lockApp();
  });
  ipcMain.handle("clarity:prefs", (event) => (fromApp(event) ? { ...prefs, touchId: touchIdAvailable() } : null));
  ipcMain.handle("clarity:set-prefs", (event, next) => (fromApp(event) ? savePrefs({ ...prefs, ...next }) : null));
  ipcMain.handle("clarity:touch-id", (event) =>
    fromApp(event) ? unlockWithTouchId() : { ok: false, error: "Not allowed." },
  );
}

function installMenu() {
  const viewItems = [
    { role: "reload" },
    ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  const template = [
    {
      label: "Clarity Mail",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Lock Clarity", accelerator: "CmdOrCtrl+L", click: () => void lockApp() },
        {
          label: "Open Data Folder",
          click: () => shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "View", submenu: viewItems },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopServer() {
  if (!server || server.exitCode !== null || server.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      resolve();
    }, 3000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    if (!server || server.exitCode !== null) return;
    event.preventDefault();
    quitting = true;
    stopServer().then(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: "Clarity Mail",
      applicationVersion: app.getVersion(),
      copyright: "Mail for this app stays on this Mac, encrypted.",
    });
    prefs = loadPrefs();
    installMenu();
    installBridge();
    hardenSessions();
    try {
      const masterKey = await masterKeyWithRetry();
      if (!masterKey) {
        quitting = true;
        app.quit();
        return;
      }
      // Older versions could leave copies of mail in the HTTP cache.
      await session.defaultSession.clearCache().catch(() => {});
      await session.defaultSession.clearStorageData({ storages: ["cachestorage", "serviceworkers"] }).catch(() => {});
      const port = await freePort(PREFERRED_PORT);
      serverPort = port;
      startServer(port, masterKey);
      await waitForServer(port);
      createWindow(port);
      watchForLock();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
      });
    } catch (err) {
      const tail = serverLog.trim().split("\n").slice(-12).join("\n");
      dialog.showErrorBox(
        "Clarity Mail",
        `${err instanceof Error ? err.message : "The local mail server did not start."}\n\n${tail}`,
      );
      quitting = true;
      await stopServer();
      app.quit();
    }
  });
}

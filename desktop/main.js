const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PREFERRED_PORT = 47317;
const ALLOWED_ENV = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "SORTED_SECRET",
];

app.setName("Clarity Mail");

let server = null;
let mainWindow = null;
let quitting = false;
let serverLog = "";

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

function appendLog(chunk) {
  const text = chunk.toString();
  serverLog = (serverLog + text).slice(-12000);
  try {
    fs.appendFileSync(userFile("server.log"), text);
  } catch {
    // The window can still open if the log file cannot be written.
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

function startServer(port) {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
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
    ...readClarityEnv(),
  };
  server = spawn(nodeBin, [serverJs], {
    cwd: serverRoot(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  const deadline = Date.now() + 45000;
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

function loadBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(userFile("window.json"), "utf8"));
    if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved;
  } catch {
    // First launch has no saved window.
  }
  return { width: 1180, height: 820 };
}

function createWindow(port) {
  const bounds = loadBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Clarity Mail",
    backgroundColor: "#f7f6f3",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const origin = `http://127.0.0.1:${port}`;
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(`${origin}/`);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.insertCSS(`
      html { background: #f7f6f3; }
      body::before {
        content: "";
        position: fixed;
        z-index: 80;
        top: 0;
        left: 0;
        right: 0;
        height: 12px;
        -webkit-app-region: drag;
      }
      aside { -webkit-app-region: drag; }
      aside a, aside button { -webkit-app-region: no-drag; }
    `).catch(() => {});
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    shell.openExternal(url);
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

function installMenu() {
  const template = [
    {
      label: "Clarity Mail",
      submenu: [
        { role: "about" },
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
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
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
      copyright: "Mail for this app stays on this Mac.",
    });
    installMenu();
    try {
      const port = await freePort(PREFERRED_PORT);
      startServer(port);
      await waitForServer(port);
      createWindow(port);
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

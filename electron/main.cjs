"use strict";

/**
 * Kyara Bot — coquille Electron.
 *
 * L'application de bureau ne réimplémente pas le bot : elle démarre le serveur
 * local existant (`src/index.js`) dans un processus Node fourni par Electron
 * (ELECTRON_RUN_AS_NODE), puis affiche le tableau de bord servi sur
 * http://127.0.0.1:<port> dans une fenêtre native.
 *
 * En mode packagé, les données (config, historique, profil Chromium) sont
 * stockées dans %APPDATA%/Kyara Bot/home, et le navigateur Playwright est
 * installé à la demande dans %APPDATA%/Kyara Bot/playwright-browsers.
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, screen, shell, dialog } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");

const APP_ROOT = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(APP_ROOT, "src", "index.js");
const PLAYWRIGHT_CLI = path.join(APP_ROOT, "node_modules", "playwright", "cli.js");
const SPLASH_FILE = path.join(__dirname, "splash.html");
const ICON_PNG = path.join(APP_ROOT, "build", "icon.png");
const ICON_ICO = path.join(APP_ROOT, "build", "icon.ico");

const APP_TITLE = "Kyara Bot";
const REPO_URL = "https://github.com/lenny59tmtc/kyara-bot-electron";
const DEV = !app.isPackaged;

// Permet de stocker les données Electron dans un dossier personnalisé
// (utile pour les tests ou une installation « portable »).
if (process.env.KYARA_USERDATA) {
  app.setPath("userData", path.resolve(process.env.KYARA_USERDATA));
}

app.setAppUserModelId("games.kyara.bot");

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProc = null;
let serverPort = 0;
let serverLog = null;
let isQuitting = false;
let restarting = false;
let authDialogShown = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.on("second-instance", () => {
  showWindow();
});

// ---------------------------------------------------------------------------
// Chemins de données
// ---------------------------------------------------------------------------

function homeDir() {
  if (process.env.KYARA_HOME) {
    const dir = path.resolve(process.env.KYARA_HOME);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (DEV) return APP_ROOT;
  const dir = path.join(app.getPath("userData"), "home");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function browsersDir() {
  return path.join(app.getPath("userData"), "playwright-browsers");
}

function logsDir() {
  const dir = DEV ? path.join(APP_ROOT, "logs") : path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appTmpDir() {
  const dir = path.join(app.getPath("userData"), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serverLogPath() {
  return path.join(logsDir(), "server.log");
}

// ---------------------------------------------------------------------------
// Utilitaires réseau
// ---------------------------------------------------------------------------

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/state", timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (Date.now() - started > timeoutMs) reject(new Error("Le serveur local n'a pas démarré à temps."));
        else setTimeout(attempt, 400);
      }
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Fenêtre de démarrage (splash)
// ---------------------------------------------------------------------------

function createSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  splashWindow = new BrowserWindow({
    width: 540,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: "#0e0c12",
    title: APP_TITLE,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(SPLASH_FILE);
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function splashStatus(text, percent) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const safeText = JSON.stringify(String(text));
  const safePercent = percent === null || percent === undefined ? "null" : String(Math.max(0, Math.min(100, Number(percent))));
  splashWindow.webContents
    .executeJavaScript(`window.setStatus && window.setStatus(${safeText}, ${safePercent});`)
    .catch(() => {});
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

// ---------------------------------------------------------------------------
// Navigateur Chromium de Playwright (installation à la demande)
// ---------------------------------------------------------------------------

function chromiumInstalled() {
  const base = browsersDir();
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("chromium-")) continue;
    const dir = path.join(base, entry.name);
    if (process.platform === "win32" && fs.existsSync(path.join(dir, "chrome-win", "chrome.exe"))) return true;
    if (process.platform === "linux" && fs.existsSync(path.join(dir, "chrome-linux", "chrome"))) return true;
    if (
      process.platform === "darwin" &&
      fs.existsSync(path.join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"))
    )
      return true;
  }
  return false;
}

function installChromium() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PLAYWRIGHT_CLI)) {
      return reject(new Error(`Playwright est introuvable : ${PLAYWRIGHT_CLI}`));
    }
    splashStatus("Téléchargement du navigateur Chromium (première installation)…", 0);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PLAYWRIGHT_BROWSERS_PATH: browsersDir() };
    if (!DEV) {
      env.TEMP = appTmpDir();
      env.TMP = env.TEMP;
    }
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "install", "chromium"], {
      cwd: APP_ROOT,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pending = "";
    child.stdout.on("data", (buf) => {
      const text = String(buf);
      if (DEV) process.stdout.write(text);
      pending = (pending + text).slice(-4000);
      const matches = pending.match(/(\d{1,3})%/g);
      if (matches && matches.length) {
        splashStatus(`Téléchargement du navigateur Chromium… ${matches[matches.length - 1]}`, null);
      }
    });
    child.stderr.on("data", (buf) => {
      if (DEV) process.stderr.write(buf);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Échec de l'installation de Chromium (code ${code}).`));
    });
  });
}

// ---------------------------------------------------------------------------
// Serveur local + bot
// ---------------------------------------------------------------------------

function serverEnv(port) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    KYARA_HOME: homeDir(),
    PORT: String(port),
    APP_VERSION: app.getVersion(),
  };
  // En développement on garde le cache Playwright global du développeur.
  if (!DEV) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersDir();
    env.TEMP = appTmpDir();
    env.TMP = env.TEMP;
  }
  delete env.NODE_OPTIONS;
  return env;
}

async function startServer() {
  serverPort = await findFreePort();
  serverLog = fs.createWriteStream(serverLogPath(), { flags: "a" });
  serverLog.write(`\n===== ${new Date().toISOString()} · démarrage serveur (port ${serverPort}) =====\n`);

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: APP_ROOT,
    env: serverEnv(serverPort),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  serverProc = proc;

  proc.stdout.on("data", (buf) => {
    serverLog?.write(buf);
    if (DEV) process.stdout.write(buf);
  });
  proc.stderr.on("data", (buf) => {
    serverLog?.write(buf);
    if (DEV) process.stderr.write(buf);
  });
  proc.on("exit", (code, signal) => {
    serverLog?.write(`[shell] serveur arrêté (code=${code}, signal=${signal})\n`);
    if (serverProc === proc) serverProc = null;
    if (!isQuitting && !restarting) onServerCrash(code, signal);
  });

  await waitForServer(serverPort);
  console.log(`[shell] serveur local prêt : http://127.0.0.1:${serverPort}`);
}

function stopServer() {
  if (!serverProc) return;
  const proc = serverProc;
  serverProc = null;
  try {
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
  } catch {}
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
    }
  } catch {}
  try {
    serverLog?.end();
  } catch {}
  serverLog = null;
}

async function restartServer() {
  restarting = true;
  try {
    const oldPort = serverPort;
    stopServer();
    await startServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(dashboardUrl());
    }
    console.log(`[shell] redémarrage terminé (ancien port ${oldPort} → ${serverPort})`);
  } finally {
    restarting = false;
  }
}

async function onServerCrash(code, signal) {
  if (authDialogShown || isQuitting) return;
  authDialogShown = true;
  const res = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    type: "error",
    buttons: ["Relancer", "Quitter"],
    defaultId: 0,
    cancelId: 1,
    title: APP_TITLE,
    message: "Le serveur du bot s'est arrêté.",
    detail:
      `Code : ${code ?? "?"}${signal ? ` · signal ${signal}` : ""}\n\n` +
      `Consulte le journal : ${serverLogPath()}`,
  });
  authDialogShown = false;
  if (res.response === 0) {
    try {
      await startServer();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(dashboardUrl());
    } catch (e) {
      dialog.showErrorBox("Redémarrage impossible", String(e?.message || e));
      isQuitting = true;
      app.quit();
    }
  } else {
    isQuitting = true;
    app.quit();
  }
}

// ---------------------------------------------------------------------------
// Fenêtre principale
// ---------------------------------------------------------------------------

function dashboardUrl() {
  return `http://127.0.0.1:${serverPort}/`;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1380, Math.max(1024, width - 80)),
    height: Math.min(940, Math.max(680, height - 80)),
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: APP_TITLE,
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG,
    backgroundColor: "#0e0c12",
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(dashboardUrl());
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function showWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (serverPort) {
    createMainWindow();
  }
}

// ---------------------------------------------------------------------------
// Icône de notification (tray)
// ---------------------------------------------------------------------------

function createTray() {
  try {
    if (!fs.existsSync(ICON_PNG)) return;
    const image = nativeImage.createFromPath(ICON_PNG);
    if (image.isEmpty()) return;
    tray = new Tray(image.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Afficher le tableau de bord", click: showWindow },
        { label: "Ouvrir dans le navigateur", click: () => serverPort && shell.openExternal(dashboardUrl()) },
        { type: "separator" },
        { label: "Dossier de données", click: () => shell.openPath(homeDir()) },
        { label: "Journal du serveur", click: () => shell.openPath(logsDir()) },
        { type: "separator" },
        {
          label: "Quitter",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("double-click", showWindow);
  } catch {
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// Menu applicatif
// ---------------------------------------------------------------------------

async function reinstallChromium() {
  const res = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    type: "question",
    buttons: ["Télécharger / réparer", "Annuler"],
    defaultId: 0,
    cancelId: 1,
    title: "Navigateur Chromium",
    message: "Réinstaller le navigateur Chromium de Playwright ?",
    detail: "Nécessite une connexion Internet (environ 150 Mo). Le bot sera redémarré.",
  });
  if (res.response !== 0) return;

  restarting = true;
  stopServer();
  createSplash();
  try {
    await installChromium();
    await startServer();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(dashboardUrl());
    closeSplash();
    await dialog.showMessageBox({
      type: "info",
      title: APP_TITLE,
      message: "Chromium installé.",
      detail: "Le bot a été relancé.",
    });
  } catch (e) {
    closeSplash();
    dialog.showErrorBox("Installation de Chromium impossible", String(e?.message || e));
    isQuitting = true;
    app.quit();
  } finally {
    restarting = false;
  }
}

function buildMenu() {
  const template = [
    {
      label: "Fichier",
      submenu: [
        {
          label: "Ouvrir le tableau de bord dans le navigateur",
          click: () => serverPort && shell.openExternal(dashboardUrl()),
        },
        { type: "separator" },
        { label: "Dossier de données", click: () => shell.openPath(homeDir()) },
        { label: "Journal du serveur", click: () => shell.openPath(serverLogPath()) },
        { type: "separator" },
        {
          label: "Quitter",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Bot",
      submenu: [
        {
          label: "Redémarrer le serveur et le bot",
          accelerator: "CmdOrCtrl+R",
          click: async () => {
            if (restarting) return;
            try {
              await restartServer();
            } catch (e) {
              dialog.showErrorBox("Redémarrage impossible", String(e?.message || e));
            }
          },
        },
        {
          label: "Afficher le tableau de bord",
          click: showWindow,
        },
        { type: "separator" },
        { label: "Réinstaller le navigateur Chromium", click: () => reinstallChromium() },
      ],
    },
    {
      label: "Affichage",
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
      label: "Aide",
      submenu: [
        { label: "Dépôt GitHub", click: () => shell.openExternal(REPO_URL) },
        { label: "Mises à jour", click: () => shell.openExternal(`${REPO_URL}/releases`) },
        {
          label: "À propos",
          click: () =>
            dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
              type: "info",
              title: "À propos",
              message: `${APP_TITLE} ${app.getVersion()}`,
              detail:
                `Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome}\n\n` +
                `Données : ${homeDir()}\nJournal : ${serverLogPath()}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Démarrage / arrêt
// ---------------------------------------------------------------------------

async function bootstrap() {
  try {
    app.setPath("temp", appTmpDir());
  } catch {}
  buildMenu();
  createTray();
  createSplash();
  try {
    if (!DEV && !chromiumInstalled()) {
      await installChromium();
    }
    splashStatus("Démarrage du serveur local et du bot…", null);
    await startServer();
    createMainWindow();
    closeSplash();
  } catch (e) {
    closeSplash();
    await dialog.showMessageBox({
      type: "error",
      title: APP_TITLE,
      message: "Démarrage impossible.",
      detail: String(e?.stack || e),
      buttons: ["Quitter"],
    });
    isQuitting = true;
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on("activate", () => {
  if (!mainWindow && serverPort) createMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServer();
});

// La fenêtre peut être masquée dans la barre de notification : on garde
// l'application (et donc le bot) en vie tant qu'on ne quitte pas explicitement.
app.on("window-all-closed", () => {
  if (!tray) {
    if (process.platform !== "darwin") app.quit();
  }
});

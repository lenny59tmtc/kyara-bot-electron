import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_PATH = path.join(SOURCE_DIR, "..", "package.json");
const REPO = "lenny59tmtc/kyara-bot-electron";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  currentVersion: null,
  latestVersion: null,
  updateAvailable: false,
  releaseUrl: null,
  downloadUrl: null,
  releaseName: null,
  publishedAt: null,
  checkedAt: null,
  error: null,
};

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")).version || null;
  } catch {
    return null;
  }
}

export function getCurrentVersion() {
  const fromEnv = process.env.APP_VERSION?.trim();
  return fromEnv || readPackageVersion() || "0.0.0";
}

function normalize(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

function parse(version) {
  return normalize(version)
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function pickDownloadAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const setup = assets.find((asset) => /setup.*\.exe$/i.test(asset.name || ""));
  const anyExe = assets.find((asset) => /\.exe$/i.test(asset.name || ""));
  return (setup || anyExe || {}).browser_download_url || release?.html_url || null;
}

export function getUpdateState() {
  return { ...state };
}

export async function checkForUpdates() {
  state.currentVersion = getCurrentVersion();
  state.checkedAt = new Date().toISOString();
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "kyara-bot-electron",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`);
    }
    const release = await response.json();
    const latest = normalize(release.tag_name || release.name || "");
    state.latestVersion = latest || null;
    state.releaseUrl = release.html_url || `https://github.com/${REPO}/releases`;
    state.downloadUrl = pickDownloadAsset(release);
    state.releaseName = release.name || null;
    state.publishedAt = release.published_at || null;
    state.updateAvailable = Boolean(latest) && compareVersions(state.currentVersion, latest) < 0;
    state.error = null;
  } catch (error) {
    state.error = error?.message || String(error);
    state.updateAvailable = false;
  }
  return getUpdateState();
}

export function startUpdateChecker() {
  state.currentVersion = getCurrentVersion();
  // Vérifie au lancement puis toutes les 5 minutes.
  checkForUpdates();
  const timer = setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

// ---------------------------------------------------------------------------
// État de la mise à jour automatique
// (écrit par le processus Electron principal dans homeDir()/update/status.json
// et lu par le serveur local pour l'afficher dans le tableau de bord).
// ---------------------------------------------------------------------------

const HOME = process.env.KYARA_HOME ? path.resolve(process.env.KYARA_HOME) : path.join(SOURCE_DIR, "..");
const AUTO_STATUS_PATH = path.join(HOME, "update", "status.json");
const INSTALL_REQUEST_PATH = path.join(HOME, "update", "install.request");
const RESTART_REQUEST_PATH = path.join(HOME, "update", "restart.request");

export function getAutoUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(AUTO_STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Demande au processus Electron principal de télécharger puis d'installer la
 * mise à jour (fichier surveillé par main.cjs).
 */
export function requestAutoUpdateInstall() {
  try {
    fs.mkdirSync(path.dirname(INSTALL_REQUEST_PATH), { recursive: true });
    fs.writeFileSync(INSTALL_REQUEST_PATH, new Date().toISOString());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

/**
 * Demande au processus Electron principal de redémarrer et d'installer la
 * mise à jour déjà téléchargée (il surveille restart.request).
 */
export function requestAutoUpdateRestart() {
  const status = getAutoUpdateState();
  if (!status || status.phase !== "downloaded") {
    return { ok: false, reason: !status ? "no_status" : `phase:${status.phase}` };
  }
  try {
    fs.mkdirSync(path.dirname(RESTART_REQUEST_PATH), { recursive: true });
    fs.writeFileSync(RESTART_REQUEST_PATH, new Date().toISOString());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

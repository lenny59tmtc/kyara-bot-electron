import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(SRC_DIR, "..");

// En mode Electron packagé, KYARA_HOME pointe vers un dossier inscriptible
// (%APPDATA%/Kyara Bot/home). En développement, on reste dans le dossier du projet.
export const ROOT = process.env.KYARA_HOME ? path.resolve(process.env.KYARA_HOME) : APP_DIR;
export const DATA_DIR = path.join(ROOT, "data");
export const PUBLIC_DIR = path.join(APP_DIR, "public");
export const PROFILE_DIR = path.join(ROOT, "profile");

const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export const RARITY_ORDER = ["C", "U", "R", "E", "L", "M"];

export const RARITY_LABELS = {
  C: "Commun",
  U: "Peu commun",
  R: "Rare",
  E: "Épique",
  L: "Légendaire",
  M: "Mythique",
};

export const RARITY_COLORS = {
  C: "#B5B1BB",
  U: "#3FBF7F",
  R: "#4D9BFF",
  E: "#B072FF",
  L: "#F5C518",
  M: "#FF4D2E",
};

const CONFIG_SCHEMA_VERSION = 2;

const DEFAULTS = {
  configVersion: CONFIG_SCHEMA_VERSION,
  pack: "all",
  openDaily: true,
  // Ouverture automatique désactivée par défaut.
  autoOpen: false,
  pollSeconds: 45,
  port: 8787,
  soundOnRare: true,
  batchMin: 6,
  batchMax: 8,
  saleType: "fixed",
  saleDurationHours: 12,
  tradesAuto: false,
  // Vente automatique des doublons — désactivée par défaut.
  autoSell: false,
  sellMaxRarity: "R",
  sellPricing: "normal",
  sellDelayMin: 30,
  sellDelayMax: 90,
  sellStealth: true,
};

export const RECYCLE_MIN = { C: 1, U: 1, R: 3, E: 10, L: 40, M: 150 };

export function loadConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {}
  const merged = { ...DEFAULTS, ...saved };
  // Migration unique : les configurations antérieures passent à l'ouverture
  // automatique désactivée par défaut. L'utilisateur peut la réactiver ensuite.
  if (Number(saved.configVersion || 0) < CONFIG_SCHEMA_VERSION) {
    merged.autoOpen = false;
    merged.configVersion = CONFIG_SCHEMA_VERSION;
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    } catch {}
  }
  return merged;
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

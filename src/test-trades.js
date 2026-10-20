import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TradeWorker } from "./trades.js";
import { loadConfig } from "./config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = process.argv[2] || path.join(ROOT, "profile");
const MODE = (process.argv[3] || "dry").toLowerCase();
const TRADES_PATH = path.join(ROOT, "data", "trades.jsonl");

const before = (() => {
  try {
    return fs.readFileSync(TRADES_PATH, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
})();

const bot = {
  config: { ...loadConfig(), tradesAuto: true },
  context: null,
  page: null,
  opening: 0,
  log: (level, msg) => console.log(`[${level}] ${msg}`),
  snapshot: () => ({}),
  ensureBrowser: async () => {
    if (bot.context && !bot.context.isClosed()) return;
    bot.context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      viewport: { width: 1360, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
    });
    bot.page = await bot.context.newPage();
    await bot.page.goto("https://kyara.games", { waitUntil: "domcontentloaded" });
    await bot.page.waitForTimeout(3000);
  },
  api: async (p) => {
    if (!bot.page || bot.page.isClosed()) return { error: "no_page" };
    return bot.page.evaluate(async (p) => {
      const token = localStorage.getItem("kyara_token");
      if (!token) return { error: "no_token" };
      const r = await fetch("/api" + p, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
        },
      });
      return await r.json().catch(() => ({ error: "bad_json", status: r.status }));
    }, p);
  },
};

const w = new TradeWorker(bot);
w.running = true;
w.state.running = true;

async function dumpCollectionShape(page) {
  const raw = await page.evaluate(async () => {
    const token = localStorage.getItem("kyara_token");
    const r = await fetch("/api/me/collection?lean=1", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
      },
    });
    return { status: r.status, text: (await r.text()).slice(0, 900) };
  });
  console.log("COLLECTION:", raw.status, raw.text);
}

try {
  const page = await w.ensureTab();
  await w.startWatchdog(page);
  await w.openBoard(page);
  await w.applyFilters(page);
  console.log("FILTRES:", JSON.stringify(w.state.filters));
  await dumpCollectionShape(page);
  const collection = await w.loadCollection(page);
  console.log("collection:", collection.size, "entrées");
  const sample = [...collection.entries()].slice(0, 2).map(([k, v]) => ({ k, v }));
  console.log("exemples:", JSON.stringify(sample));

  const offers = await w.readOffers(page);
  const valid = offers.filter((o) => w.matchesFilters(o, collection));
  console.log(`annonces DOM: ${offers.length}, valides: ${valid.length}`);
  console.log("valides:", JSON.stringify(valid.slice(0, 5), null, 1));

  if (MODE === "accept" && valid.length) {
    const realAccept = w.acceptAll.bind(w);
    w.acceptAll = async (list, pg, col) => realAccept(list.slice(0, 1), pg, col);
    await w.cycle();
    console.log("état:", JSON.stringify(w.snapshot(), null, 1));
  } else if (MODE === "accept") {
    console.log("aucune annonce valide — rien à accepter");
  }
} catch (e) {
  console.log("ERREUR:", e?.message || e);
} finally {
  w.stopWatchdog();
  try {
    await w.stop();
  } catch {}
  try {
    if (bot.context && !bot.context.isClosed()) await bot.context.close();
  } catch {}
}

const after = (() => {
  try {
    return fs.readFileSync(TRADES_PATH, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
})();
console.log(`trades.jsonl: ${before} → ${after.length}`);
if (after.length > before) console.log("dernier:", after[after.length - 1]);
process.exit(0);

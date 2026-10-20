import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TradeWorker } from "./trades.js";
import { loadConfig } from "./config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = process.argv[2] || path.join(ROOT, "profile");

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
    await bot.page.waitForTimeout(2500);
  },
};

const w = new TradeWorker(bot);
w.running = true;

const time = async (label, fn) => {
  const t = Date.now();
  await fn();
  const ms = Date.now() - t;
  console.log(`${label}: ${ms} ms`);
  return ms;
};

try {
  const page = await w.ensureTab();
  if (process.env.NO_WATCHDOG !== "1") w.startWatchdog(page);

  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    await w.cycle();
    const ms = Date.now() - t;
    const tsel = await page.$$eval('button[role="tab"]', (els) => els.map((e) => `${e.innerText.trim()}=${e.getAttribute("aria-selected")}`).join(" "));
    console.log(`cycle #${i}: ${ms} ms | filtres=${JSON.stringify(w.state.filters)} candidats=${w.state.candidates} URL=${page.url()}`);
    console.log(`  onglets: ${tsel}`);
    await page.waitForTimeout(400 + Math.random() * 600);
  }
  await page.screenshot({ path: path.join(ROOT, "recon", "tabs-refresh.png") });
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
process.exit(0);

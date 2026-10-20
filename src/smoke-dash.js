import { chromium } from "playwright";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT) || 8798;
const base = `http://127.0.0.1:${PORT}`;

const bot = {
  config: { pack: "all", tradesAuto: true, soundOnRare: true },
  state: { pack: "all" },
  running: false,
  log: () => {},
  snapshot: () => ({
    running: false,
    pseudo: "test",
    freePacks: 1,
    trade: {
      running: true,
      accepted: 3,
      cards: 3,
      candidates: 2,
      filters: { missing: true, dupes: true },
      waitingOpening: false,
      lastCycleAt: new Date().toISOString(),
      lastError: null,
    },
    log: [
      { at: new Date().toISOString(), level: "info", msg: "Échanges · 2 échange(s) disponible(s) — validation immédiate" },
      { at: new Date().toISOString(), level: "info", msg: "Échanges · Échange accepté: Test (U) contre Dup" },
      { at: new Date().toISOString(), level: "info", msg: "Lot 1/5" },
    ],
  }),
  trades: {
    snapshot: () => ({
      running: true,
      accepted: 3,
      cards: 3,
      candidates: 2,
      filters: { missing: true, dupes: true },
      waitingOpening: false,
      lastCycleAt: new Date().toISOString(),
      lastError: null,
    }),
  },
};

await createServer(bot);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

await page.click("#tabTrade");
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const txt = (id) => (document.getElementById(id)?.textContent || "").replace(/\s+/g, " ").trim();
  const html = (id) => (document.getElementById(id)?.innerHTML || "").length;
  const visible = (id) => {
    const el = document.getElementById(id);
    return !!el && el.style.display !== "none";
  };
  return {
    tabActive: document.getElementById("tabTrade")?.classList.contains("on"),
    viewVisible: visible("viewTrade"),
    tradeCount: txt("tradeCount"),
    tradeStats: html("tradeStats"),
    tradeRarities: txt("tradeRarities"),
    tradeStatus: txt("tradeStatus"),
    tradeAt: txt("tradeAt"),
    tradeBuckets: html("tradeBuckets"),
    tradeList: html("tradeList"),
    tradeLog: txt("tradeLog"),
    tradesAutoChecked: document.getElementById("tradesAuto")?.checked,
    logsRendered: document.querySelectorAll("#log .info").length,
  };
});
console.log("APRÈS CLIC:", JSON.stringify(out, null, 1));

await page.screenshot({ path: "recon/dash-trade.png", fullPage: false });

await page.click("#tabOpen");
await page.waitForTimeout(500);
const back = await page.evaluate(() => ({
  viewTradeHidden: document.getElementById("viewTrade").style.display === "none",
  viewOpenVisible: document.getElementById("viewOpen").style.display !== "none",
}));
console.log("RETOUR:", JSON.stringify(back));

console.log("ERREURS CONSOLE:", errors.length ? errors : "aucune");
await browser.close();
process.exit(errors.length ? 1 : 0);

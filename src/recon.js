import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(ROOT, "..", "profile");
const OUT = path.join(ROOT, "..", "recon");
fs.mkdirSync(OUT, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] ?? (await context.newPage());

const log = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/")) return;
  let body = null;
  try {
    body = await res.json();
  } catch {
    try {
      body = (await res.text()).slice(0, 500);
    } catch {}
  }
  log.push({ url: url.replace("https://kyara.games", ""), status: res.status(), body });
});

await page.goto("https://kyara.games/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, "01-home.png"), fullPage: false });

console.log("\n=== État actuel ===");
const state = await page.evaluate(() => ({
  token: localStorage.getItem("kyara_token") ? "présent" : "absent",
  device: localStorage.getItem("kyara_device"),
}));
console.log(state);

const tokenBefore = await page.evaluate(() => localStorage.getItem("kyara_token"));
console.log("\nConnecte-toi à ton compte Kyara dans la fenêtre Chrome...");
console.log("(détection automatique, max 8 minutes)");

const deadline = Date.now() + 8 * 60 * 1000;
let loggedIn = false;
while (Date.now() < deadline) {
  if (context.isClosed()) {
    console.log("Fermeture du navigateur.");
    process.exit(0);
  }
  const t = await page.evaluate(() => localStorage.getItem("kyara_token")).catch(() => null);
  if (t && t !== tokenBefore) {
    loggedIn = true;
    break;
  }
  await page.waitForTimeout(2000).catch(() => {});
}
console.log(loggedIn ? "Connexion détectée." : "Pas de connexion détectée, on continue en invité.");
await page.waitForTimeout(3000);
rl.close();

const dump = await page.evaluate(async () => {
  const get = async (u) => {
    try {
      const r = await fetch("/api" + u, {
        headers: {
          authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
          "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
        },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      return { error: String(e) };
    }
  };
  return {
    me: await get("/me"),
    packs: await get("/packs"),
    packState: await get("/me/packs"),
  };
});
fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(dump, null, 2));
await page.screenshot({ path: path.join(OUT, "02-after-login.png") });

console.log("\n=== /me ===");
console.log(JSON.stringify(dump.me, null, 2).slice(0, 800));
console.log("\n=== /packs (catalogue) ===");
console.log(JSON.stringify(dump.packs, null, 2).slice(0, 3000));
console.log("\n=== /me/packs (état) ===");
console.log(JSON.stringify(dump.packState, null, 2).slice(0, 3000));

fs.writeFileSync(path.join(OUT, "network.json"), JSON.stringify(log, null, 2));
console.log(`\n${log.length} réponses réseau sauvegardées dans recon/network.json`);
await page.screenshot({ path: path.join(OUT, "03-final.png") });
await page.waitForTimeout(15000);
await context.close();
process.exit(0);

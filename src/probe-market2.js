import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "recon");

const context = await chromium.launchPersistentContext(path.join(ROOT, "profile"), { headless: false, viewport: { width: 1280, height: 860 } });
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
if (page.url().startsWith("about:blank")) await page.goto("https://kyara.games/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const api = (p) =>
  page.evaluate(async (path) => {
    const r = await fetch("/api" + path, {
      headers: {
        authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
        "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
      },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, p);

const full = await api("/me/collection");
console.log("collection pleine status", full.status);
const items = Array.isArray(full.body) ? full.body : full.body?.cards || [];
console.log("nb:", items.length, "exemple:", JSON.stringify(items[0], null, 2).slice(0, 800));
fs.writeFileSync(path.join(OUT, "collection-full.json"), JSON.stringify(full).slice(0, 2000000));

for (const q of ["characterId=91", "character=91", "ids=91", "q=91"]) {
  const r = await api(`/market/listings?${q}&pageSize=5`);
  console.log(`listings?${q} →`, r.status, JSON.stringify(r.body).slice(0, 400));
}

const chars = await api("/characters?limit=2");
console.log("/characters →", chars.status, JSON.stringify(chars.body).slice(0, 500));
const one = await api("/characters/91");
console.log("/characters/91 →", one.status, JSON.stringify(one.body).slice(0, 600));

await context.close();
process.exit(0);

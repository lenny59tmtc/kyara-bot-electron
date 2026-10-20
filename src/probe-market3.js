import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = await chromium.launchPersistentContext(path.join(ROOT, "profile"), { headless: false, viewport: { width: 1280, height: 860 } });
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
if (page.url().startsWith("about:blank")) await page.goto("https://kyara.games/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const api = (p) =>
  page.evaluate(async (path) => {
    const t0 = performance.now();
    const r = await fetch("/api" + path, {
      headers: {
        authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
        "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
      },
    });
    const text = await r.text();
    return { status: r.status, ms: Math.round(performance.now() - t0), bytes: text.length, body: text.slice(0, 300) };
  }, p);

const cat = await api("/characters");
console.log("/characters:", cat.status, cat.bytes, "octets", cat.ms + "ms");

for (const q of ["characterId=126357&pageSize=5", "characterId=126357&pageSize=5&sort=priceAsc", "characterId=126357&pageSize=5&sort=priceAsc&status=active"]) {
  const r = await api(`/market/listings?${q}`);
  console.log(`?${q} →`, r.status, r.bytes, "o", r.body);
}

await context.close();
process.exit(0);

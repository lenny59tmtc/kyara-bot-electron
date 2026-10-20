import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "recon");
fs.mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(path.join(ROOT, "profile"), {
  headless: false,
  viewport: { width: 1280, height: 860 },
});
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

const collection = await api("/me/collection?lean=1");
fs.writeFileSync(path.join(OUT, "collection.json"), JSON.stringify(collection, null, 2));
console.log("collection status", collection.status);
const items = Array.isArray(collection.body) ? collection.body : collection.body?.cards || collection.body?.items || [];
console.log("nb entrées:", items.length);
console.log("exemple entrée:", JSON.stringify(items[0], null, 2));
const dupes = items.filter((i) => (i.qty ?? i.count ?? i.q ?? 0) > 1);
console.log("doublons:", dupes.length, "ex:", JSON.stringify(dupes.slice(0, 3), null, 2));

if (items.length) {
  const ids = items.slice(0, 5).map((i) => i.characterId ?? i.id).join(",");
  const prices = await api(`/me/collection/prices?ids=${ids}`);
  fs.writeFileSync(path.join(OUT, "prices.json"), JSON.stringify(prices, null, 2));
  console.log("prices status", prices.status, JSON.stringify(prices.body, null, 2).slice(0, 2000));
}

const listings = await api("/market/listings?sort=ending&pageSize=3");
fs.writeFileSync(path.join(OUT, "listings.json"), JSON.stringify(listings, null, 2));
console.log("listings status", listings.status, JSON.stringify(listings.body, null, 2).slice(0, 2500));

const mine = await api("/me/market");
fs.writeFileSync(path.join(OUT, "market-mine.json"), JSON.stringify(mine, null, 2));
console.log("me/market status", mine.status, JSON.stringify(mine.body, null, 2).slice(0, 1200));

const orders = await api("/market/buy-orders?pageSize=3");
fs.writeFileSync(path.join(OUT, "buy-orders.json"), JSON.stringify(orders, null, 2));
console.log("buy-orders status", orders.status, JSON.stringify(orders.body, null, 2).slice(0, 1500));

await context.close();
process.exit(0);

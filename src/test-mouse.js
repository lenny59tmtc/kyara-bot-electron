import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = process.argv[2] || path.join(ROOT, "profile");

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1360, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
});
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await page.locator("section.board").waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

const time = async (label, fn) => {
  const t = Date.now();
  await fn();
  const ms = Date.now() - t;
  console.log(`${label}: ${ms} ms`);
  return ms;
};

const nb = await page.locator("section.board ul.offers li.offer").count();
const pills = await page.locator("section.board .filters button.pill").count();
console.log(`annonces=${nb} pills=${pills}`);

for (let i = 0; i < 3; i++) {
  const sx = 180 + Math.random() * 760;
  const sy = 140 + Math.random() * 520;
  await time(`  move aléatoire (${Math.round(sx)},${Math.round(sy)}) steps=6`, () => page.mouse.move(sx, sy, { steps: 6 }));
}
await time("  move simple sans steps", () => page.mouse.move(400, 300));
await time("  move vers pilule steps=6", async () => {
  const box = await page.locator("section.board .filters button.pill").first().boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
});
await time("  boundingBox pilule", async () => page.locator("section.board .filters button.pill").first().boundingBox());
await time("  evaluate léger", async () => page.evaluate(() => document.querySelectorAll("li.offer").length));

console.log("--- avec ouverture de la 2e page onglet? non ---");
console.log("onglets:", await page.$$eval('button[role="tab"]', (els) => els.map((e) => e.innerText.trim()).join("|")));

await context.close();
process.exit(0);

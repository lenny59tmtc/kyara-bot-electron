import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = process.argv[2] || path.join(ROOT, "profile");
const OUT = path.join(ROOT, "recon");
fs.mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1360, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
});
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());

let offersHits = 0;
page.on("request", (r) => {
  if (r.url().includes("/api/trades/offers")) offersHits++;
});

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log("URL init:", page.url());

const tabs = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('a[href*="onglet="], button, [role="tab"], nav a, nav button').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 40) return;
    out.push({
      tag: el.tagName,
      role: el.getAttribute("role"),
      cls: String(el.className).slice(0, 80),
      href: el.getAttribute("href"),
      text,
      sel: el.getAttribute("aria-selected") || el.getAttribute("aria-current") || "",
      onglet: (el.getAttribute("href") || "").match(/onglet=([a-z]+)/)?.[1] || "",
    });
  });
  return out;
});
console.log("ONGLETS/NAV:", JSON.stringify(tabs, null, 1).slice(0, 6000));

const count = async () => page.locator("section.board ul.offers li.offer").count().catch(() => -1);
console.log("annonces:", await count(), "| requêtes /trades/offers:", offersHits);

const findTab = (label) =>
  page.locator(`a[href*="onglet="], nav button, nav a, [role="tab"]`).filter({ hasText: new RegExp(label, "i") }).first();

for (const label of ["Mon activité", "Échanges", "Echanges"]) {
  const t = findTab(label);
  console.log(`onglet « ${label} »: ${await t.count()} trouvé(s)`);
}

const act = findTab("Mon activité");
if (await act.count()) {
  const href = await act.getAttribute("href");
  console.log("→ clic Mon activité (href=" + href + ")");
  await act.click().catch((e) => console.log("clic KO:", e.message));
  await page.waitForTimeout(1500);
  console.log("  URL:", page.url(), "| annonces:", await count(), "| requêtes:", offersHits);
  console.log("  sections:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("section, [class*=board]")].map((s) => String(s.className).slice(0, 40)))));
}

const exch = findTab("Échanges");
if (await exch.count()) {
  const href = await exch.getAttribute("href");
  console.log("→ clic Échanges (href=" + href + ")");
  await exch.click().catch((e) => console.log("clic KO:", e.message));
  await page.waitForTimeout(1500);
  console.log("  URL:", page.url(), "| annonces:", await count(), "| requêtes:", offersHits);
  const pills = await page
    .$$eval("section.board .filters button.pill", (els) => els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })))
    .catch((e) => e.message);
  console.log("  pastilles:", JSON.stringify(pills));
}

await page.screenshot({ path: path.join(OUT, "tabs-market.png") });
await context.close();
process.exit(0);

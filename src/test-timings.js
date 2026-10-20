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

const pills = () =>
  page.$$eval("section.board .filters button.pill", (els) =>
    els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed"), w: Math.round(e.getBoundingClientRect().width) })),
  );

const poll = async (label, fn, timeout = 6000) => {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const v = await fn();
    if (v) {
      console.log(`  ${label}: ${Date.now() - t} ms`);
      return Date.now() - t;
    }
    await page.waitForTimeout(60);
  }
  console.log(`  ${label}: TIMEOUT (${timeout} ms)`);
  return timeout;
};

const clickTab = async (label) => {
  const tab = page.locator('button[role="tab"]').filter({ hasText: label }).first();
  const t = Date.now();
  await tab.click();
  console.log(`  clic onglet « ${label} »: ${Date.now() - t} ms`);
};

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await poll("board visible", async () => (await page.locator("section.board").count()) > 0);
await poll("pills >= 3", async () => (await page.locator("section.board .filters button.pill").count()) >= 3);
console.log("pills init:", JSON.stringify(await pills()));

const clickPill = async (idx, label) => {
  const t0 = Date.now();
  const el = page.locator("section.board .filters button.pill").nth(idx);
  await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.down();
    await page.waitForTimeout(45);
    await page.mouse.up();
  } else {
    await el.click();
  }
  const clickMs = Date.now() - t0;
  const okMs = await poll(`aria-pressed « ${label} »`, async () => {
    const p = await pills();
    return p[idx]?.pressed === "true";
  });
  console.log(`  pilule ${idx}: clic ${clickMs} ms + confirmation ${okMs ?? "-"} ms`);
};

console.log("— 1er passage (frais) —");
await clickPill(0, "Que je n'ai pas");
await clickPill(2, "Contre mes doublons");

console.log("— onglets —");
let t = Date.now();
await clickTab("Mon activité");
await poll("board détaché", async () => (await page.locator("section.board").count()) === 0, 4000);
console.log(`  total Mon activité: ${Date.now() - t} ms`);

t = Date.now();
await clickTab("Échanges");
await poll("board présent", async () => (await page.locator("section.board").count()) > 0, 6000);
await poll("pills >= 3", async () => (await page.locator("section.board .filters button.pill").count()) >= 3, 6000);
console.log(`  total retour Échanges: ${Date.now() - t} ms`);
console.log("pills après retour:", JSON.stringify(await pills()));

console.log("— 2e passage (après retour d'onglet) —");
const now = await pills();
if (now[0]?.pressed === "true" && now[2]?.pressed === "true") {
  console.log("  filtres conservés (aucun clic nécessaire)");
} else {
  if (now[0]?.pressed !== "true") await clickPill(0, "Que je n'ai pas");
  if (now[2]?.pressed !== "true") await clickPill(2, "Contre mes doublons");
}

console.log("— flux des offres —");
const offers = await page.locator("section.board ul.offers li.offer").count();
const empty = await page.evaluate(() => (document.querySelector("section.board")?.innerText || "").includes("Rien ne correspond"));
console.log(`  annonces=${offers} vide=${empty}`);
if (offers) {
  const t1 = Date.now();
  const btns = await page.locator("section.board ul.offers li.offer .acts button.btn-acc").count();
  console.log(`  boutons Donner: ${btns} (${Date.now() - t1} ms)`);
}

await page.screenshot({ path: path.join(ROOT, "recon", "timings.png") });
await context.close();
process.exit(0);

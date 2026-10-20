import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = process.argv[2] || path.join(ROOT, "profile");
const OUT = path.join(ROOT, "recon");
fs.mkdirSync(OUT, { recursive: true });

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019\u02bc\u00b4\u0060\u02b9]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1360, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
});
const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());

const api = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/trades")) api.push(`${r.status()} ${u.replace("https://kyara.games", "")}`);
});

const storage = async () =>
  page.evaluate(() => {
    const s = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      s["session:" + k] = sessionStorage.getItem(k);
    }
    const l = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === "kyara_token" || k === "kyara_device") continue;
      l[k] = localStorage.getItem(k);
    }
    return { session: s, local: l };
  });

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const pillsBefore = await page
  .$$eval("section.board .filters button.pill", (els) => els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })))
  .catch((e) => e.message);
console.log("PASTILLES:", JSON.stringify(pillsBefore));

for (const wanted of [
  ["que je n'ai pas", "ones i don't have", "ones i dont have"],
  ["contre mes doublons", "for my duplicates"],
]) {
  for (let a = 0; a < 3; a++) {
    const list = await page.$$eval("section.board .filters button.pill", (els) =>
      els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })),
    ).catch(() => []);
    const hit = list.find((p) => wanted.includes(norm(p.text)));
    if (!hit) {
      await page.waitForTimeout(700);
      continue;
    }
    if (hit.pressed !== "true") {
      await page.locator("section.board .filters button.pill").nth(hit.i).click();
      await page.waitForTimeout(700);
    }
    const after = await page.$$eval("section.board .filters button.pill", (els) =>
      els.map((e, i) => ({ i, pressed: e.getAttribute("aria-pressed") })),
    );
    if (after.find((p) => p.i === hit.i)?.pressed === "true") break;
  }
}

const offers = await page.$$eval("section.board ul.offers li.offer", (items) =>
  items.map((li) => ({
    id: li.id,
    name: (li.querySelector(".give .gi b")?.textContent || "").trim(),
    btns: [...li.querySelectorAll(".acts button")].map((b) => b.className + " :: " + (b.textContent || "").trim().slice(0, 40)),
  })),
).catch((e) => e.message);
console.log("ANNONCES:", JSON.stringify(offers, null, 1).slice(0, 2500));

const target = page.locator("section.board ul.offers li.offer").filter({ has: page.locator(".acts button.btn-acc") }).first();
const hasTarget = await target.count();
if (!hasTarget) {
  console.log("aucun bouton d'échange cliquable");
  await page.screenshot({ path: path.join(OUT, "confirm-none.png") });
  await context.close();
  process.exit(0);
}

const beforeStore = await storage();
const name = (await target.locator(".give .gi b").first().textContent())?.trim();
console.log("clic sur le bouton de:", name);

await target.locator(".acts button.btn-acc").first().click({ timeout: 10000 }).catch((e) => console.log("clic échoué:", e.message));
await page.waitForTimeout(1200);

const dialogInfo = await page.evaluate(() => {
  const cands = [
    ...document.querySelectorAll('[role="dialog"], .modal, .modal-wrap, .dialog, .overlay, .confirm, [class*="modal"], [class*="confirm"], [class*="dialog"]'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  });
  const el = cands[cands.length - 1] || null;
  if (!el) return { found: false, body: document.body.innerText.slice(0, 600) };
  return {
    found: true,
    tag: el.tagName,
    cls: el.className,
    text: el.innerText.replace(/\s+/g, " ").slice(0, 500),
    inputs: [...el.querySelectorAll("input")].map((i) => ({
      type: i.type,
      id: i.id,
      name: i.name,
      checked: i.checked,
      value: i.value,
      label: (i.closest("label")?.innerText || document.querySelector(`label[for="${i.id}"]`)?.innerText || "").replace(/\s+/g, " ").slice(0, 120),
    })),
    buttons: [...el.querySelectorAll("button, [role=button]")].map((b) => ({
      text: (b.innerText || "").replace(/\s+/g, " ").trim(),
      cls: b.className,
      type: b.type,
    })),
    html: el.outerHTML.slice(0, 4000),
  };
});
console.log("FENÊTRE:", JSON.stringify(dialogInfo, null, 1));
await page.screenshot({ path: path.join(OUT, "confirm-dialog.png") });

if (dialogInfo.found && dialogInfo.inputs.length) {
  const cb = page.locator('[role="dialog"] input[type=checkbox], .modal input[type=checkbox], [class*="modal"] input[type=checkbox]').first();
  if (await cb.count()) {
    if (!(await cb.isChecked().catch(() => false))) await cb.click().catch((e) => console.log("coche échouée:", e.message));
    await page.waitForTimeout(400);
    const afterStore = await storage();
    const diff = [];
    for (const k of Object.keys(afterStore.session)) {
      if (beforeStore.session[k] !== afterStore.session[k]) diff.push(`session:${k} = ${String(afterStore.session[k]).slice(0, 80)}`);
    }
    for (const k of Object.keys(afterStore.local)) {
      if (beforeStore.local[k] !== afterStore.local[k]) diff.push(`local:${k} = ${String(afterStore.local[k]).slice(0, 80)}`);
    }
    for (const k of Object.keys(beforeStore.session)) if (!(k in afterStore.session)) diff.push(`session supprimé: ${k}`);
    for (const k of Object.keys(beforeStore.local)) if (!(k in afterStore.local)) diff.push(`local supprimé: ${k}`);
    console.log("STORAGE AVANT:", JSON.stringify(beforeStore));
    console.log("DIFF STORAGE:", diff.length ? diff : "aucune");
    await page.screenshot({ path: path.join(OUT, "confirm-checked.png") });
  }
}

const cancel = page
  .locator('[role="dialog"] button, .modal button, [class*="modal"] button')
  .filter({ hasText: /annuler|cancel|non|retour|fermer|close/i })
  .first();
if (await cancel.count()) {
  console.log("annulation via:", (await cancel.textContent())?.trim());
  await cancel.click().catch((e) => console.log("annulation échouée:", e.message));
} else {
  await page.keyboard.press("Escape").catch(() => {});
}
await page.waitForTimeout(1200);

const afterClose = await page.evaluate(() => ({
  dialogOpen: !!document.querySelector('[role="dialog"][aria-modal="true"], .modal, [class*="modal"].open'),
  stillThere: !!document.querySelector('section.board ul.offers li.offer'),
  count: document.querySelectorAll("section.board ul.offers li.offer").length,
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
}));
console.log("APRÈS FERMETURE:", JSON.stringify(afterClose));
console.log("API:", api.slice(-10));

await context.close();
process.exit(0);

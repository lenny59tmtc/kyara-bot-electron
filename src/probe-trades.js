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

const logs = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/trades") || u.includes("/api/me/collection")) logs.push(`${r.status()} ${u.replace("https://kyara.games", "")}`);
});

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

console.log("URL:", page.url());
console.log(
  "token:",
  await page.evaluate(() => (localStorage.getItem("kyara_token") ? "présent" : "ABSENT")),
);
console.log(
  "pseudo:",
  await page.evaluate(() => document.querySelector("header a[href^='/profil/'], header [class*=avatar]")?.textContent?.trim() || "?"),
);

const pills = await page
  .$$eval("section.board .filters button.pill", (els) => els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })))
  .catch((e) => ({ error: e.message }));
console.log("PASTILLES:", JSON.stringify(pills, null, 1));

async function readPills() {
  return page.$$eval("section.board .filters button.pill", (els) =>
    els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })),
  );
}

for (const [label, wanted] of [
  ["Que je n'ai pas", ["que je n'ai pas", "ones i don't have", "ones i dont have"]],
  ["Contre mes doublons", ["contre mes doublons", "for my duplicates"]],
]) {
  let ok = false;
  for (let a = 0; a < 3 && !ok; a++) {
    const list = await readPills().catch(() => []);
    const hit = list.find((p) => wanted.includes(norm(p.text)));
    if (!hit) {
      console.log(`filtre « ${label} » introuvable (essai ${a + 1})`);
      await page.waitForTimeout(800);
      continue;
    }
    if (hit.pressed !== "true") {
      console.log(`clic sur « ${label} » (index ${hit.i})`);
      await page.locator("section.board .filters button.pill").nth(hit.i).click();
      await page.waitForTimeout(700);
    }
    const after = await readPills();
    ok = (after.find((p) => p.i === hit.i)?.pressed ?? "") === "true";
    console.log(`  « ${label} » aria-pressed=${ok}`);
  }
  if (!ok) console.log(`!!! filtre « ${label} » NON sélectionné`);
}

await page.waitForTimeout(900);
const offers = await page
  .$$eval("section.board ul.offers li.offer", (items) =>
    items.map((li) => {
      const id = String(li.id || "").replace(/^offre-/, "");
      const href = li.querySelector(".give a.big")?.getAttribute("href") || "";
      const thumbs = [...li.querySelectorAll(".want .thumbs a.thumb")];
      const have = thumbs.filter((a) => a.classList.contains("have"));
      return {
        id,
        cardId: Number(href.match(/\/wiki\/(\d+)/)?.[1] || 0) || null,
        name: (li.querySelector(".give .gi b")?.textContent || "").trim(),
        user: (li.querySelector('.give .gi a[href^="/profil/"]')?.textContent || "").trim(),
        mine: li.classList.contains("mine"),
        wantCount: thumbs.length,
        have: have.map((a) => (a.getAttribute("href") || "").match(/\/wiki\/(\d+)/)?.[1]),
        buttons: [...li.querySelectorAll(".acts button")].map((b) => ({
          cls: b.className,
          text: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
          disabled: b.disabled,
        })),
      };
    }),
  )
  .catch((e) => ({ error: e.message }));
console.log("OFFRES:", JSON.stringify(offers, null, 1)?.slice(0, 6000));
console.log("REQUETES:", logs.slice(0, 20));

const sections = await page
  .evaluate(() => ({
    board: !!document.querySelector("section.board"),
    offers: document.querySelectorAll("section.board ul.offers li.offer").length,
    empty: document.querySelector("section.board")?.textContent?.replace(/\s+/g, " ").slice(0, 300),
  }))
  .catch((e) => ({ error: e.message }));
console.log("DOM:", JSON.stringify(sections, null, 1));

await page.screenshot({ path: path.join(OUT, "trades-board.png"), fullPage: false });
await context.close();
process.exit(0);

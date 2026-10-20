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

const bodies = {};
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/trades/offers") && !u.includes("mine") && !bodies.offers) {
    bodies.offers = await r.text().catch(() => "err");
  }
  if (u.includes("/api/me") && !u.includes("/") === false) {
    if (u.endsWith("/api/me") && !bodies.me) bodies.me = await r.text().catch(() => "err");
  }
});

await page.goto("https://kyara.games/marche?onglet=offres", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const me = await page.evaluate(async () => {
  const r = await fetch("/api/me", {
    headers: {
      authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
      "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
    },
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, pseudo: j?.pseudo, chakra: j?.chakra, freePacks: j?.freePacks };
});
console.log("ME:", JSON.stringify(me));

const raw = await page.evaluate(async () => {
  const r = await fetch("/api/trades/offers", {
    headers: {
      authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
      "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
    },
  });
  const t = await r.text();
  return { status: r.status, body: t };
});
console.log("OFFERS status:", raw.status, "bytes:", raw.body.length);
console.log("OFFERS body:", raw.body.slice(0, 2500));

const before = await page.$$eval("section.board ul.offers li.offer", (els) => els.length).catch(() => -1);
console.log("annonces affichées (sans filtre):", before);

async function readPills() {
  return page.$$eval("section.board .filters button.pill", (els) =>
    els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })),
  );
}
for (const wanted of [
  ["que je n'ai pas", "ones i don't have", "ones i dont have"],
  ["contre mes doublons", "for my duplicates"],
]) {
  for (let a = 0; a < 3; a++) {
    const list = await readPills().catch(() => []);
    const hit = list.find((p) => wanted.includes(norm(p.text)));
    if (!hit) {
      await page.waitForTimeout(700);
      continue;
    }
    if (hit.pressed !== "true") {
      await page.locator("section.board .filters button.pill").nth(hit.i).click();
      await page.waitForTimeout(700);
    }
    const after = await readPills();
    if ((after.find((p) => p.i === hit.i)?.pressed ?? "") === "true") break;
  }
}
await page.waitForTimeout(900);
const after = await page.$$eval("section.board ul.offers li.offer", (els) =>
  els.map((li) => {
    const thumbs = [...li.querySelectorAll(".want .thumbs a.thumb")];
    const have = thumbs.filter((a) => a.classList.contains("have"));
    return {
      id: li.id,
      name: (li.querySelector(".give .gi b")?.textContent || "").trim(),
      mine: li.classList.contains("mine"),
      wants: thumbs.length,
      have: have.length,
      btns: [...li.querySelectorAll(".acts button.btn-acc")].length,
      allBtns: [...li.querySelectorAll(".acts button")].map((b) => b.className + " :: " + (b.textContent || "").trim().slice(0, 30)),
    };
  }),
).catch((e) => ({ error: e.message }));
console.log("annonces avec les 2 filtres:", JSON.stringify(after, null, 1)?.slice(0, 4000));

await page.screenshot({ path: path.join(OUT, "trades-board2.png") });
await context.close();
process.exit(0);

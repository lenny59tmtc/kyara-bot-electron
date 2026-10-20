import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = path.join(ROOT, "profile");
const OUT = path.join(ROOT, "recon");
fs.mkdirSync(OUT, { recursive: true });

const packId = process.argv[2] || "all";

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] ?? (await context.newPage());

let opened = null;
let turnstileSeen = false;

page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/packs")) return;
  let body = null;
  try {
    body = await res.json();
  } catch {}
  console.log(`[NET] ${res.status()} ${url.replace("https://kyara.games", "")}`);
  if (url.includes("/open")) {
    opened = { url, status: res.status(), body };
    fs.writeFileSync(path.join(OUT, "open-response.json"), JSON.stringify(opened, null, 2));
  }
});

page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.log(`[NAV] ${f.url()}`);
});

await page.goto(`https://kyara.games/ouvrir/${packId}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(OUT, "p01-loaded.png") });

const dumpInteractive = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a[href], [role=button], canvas, svg, [class*='boost'], [class*='pack'], [class*='Booster'], [class*='lid'], [class*='seal']")];
    return els.slice(0, 60).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName,
        cls: (e.className?.baseVal ?? e.className ?? "").toString().slice(0, 80),
        text: (e.textContent || "").trim().slice(0, 60),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
  });

console.log("=== éléments interactifs ===");
console.log(JSON.stringify(await dumpInteractive(), null, 1));

const freeLeft = async () =>
  page.evaluate(async () => {
    const r = await fetch("/api/me", {
      headers: {
        authorization: `Bearer ${localStorage.getItem("kyara_token")}`,
        "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
      },
    });
    const j = await r.json();
    return { freePacks: j.freePacks, daily: j.dailyPack ?? null, nextFreeAt: j.nextFreeAt };
  });
console.log("état avant:", await freeLeft());

// Turnstile: clique sur la case si elle apparaît
async function tryTurnstile() {
  for (let i = 0; i < 20 && !opened; i++) {
    const box = page.locator(".ts-box").first();
    if (await box.count()) {
      console.log("[TS] widget turnstile détecté");
      turnstileSeen = true;
      await page.screenshot({ path: path.join(OUT, "p-ts.png") });
      const frame = page.frameLocator(".ts-box iframe").first();
      try {
        await frame.locator("body").click({ position: { x: 30, y: 30 }, timeout: 4000 });
        console.log("[TS] clic effectué");
      } catch (e) {
        console.log("[TS] clic impossible:", e.message.slice(0, 100));
      }
    }
    await page.waitForTimeout(1000);
  }
}

// 1) essaye de cliquer chaque candidat
const candidates = await dumpInteractive();
for (const c of candidates) {
  if (opened) break;
  if (!c.box.w || !c.box.h) continue;
  if (c.tag === "A" && !c.text.toLowerCase().includes("open")) continue;
  try {
    console.log(`[CLICK] ${c.tag} "${c.text}" @${c.box.x},${c.box.y}`);
    await page.mouse.click(c.box.x + c.box.w / 2, c.box.y + c.box.h / 2);
    await page.waitForTimeout(1500);
    if (!page.url().includes(`/ouvrir/${packId}`)) {
      console.log("[NAV] redirection, retour à la page d'ouverture");
      await page.goto(`https://kyara.games/ouvrir/${packId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      continue;
    }
    if ((await tryTurnstile(), opened)) break;
  } catch (e) {
    console.log("[CLICK] échec:", e.message.slice(0, 80));
  }
  await page.screenshot({ path: path.join(OUT, `p-click-${c.tag}.png`) });
}

// 2) sinon: geste de glissement (ouvrir la boîte)
if (!opened) {
  console.log("[GESTE] tentative de drag sur le centre de l'écran");
  await tryTurnstile();
  const cx = 700;
  const cy = 480;
  for (const dy of [-200, -140, 200]) {
    if (opened) break;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx, cy + (dy * i) / 10);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await tryTurnstile();
  }
}

await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, "p-final.png") });
console.log("=== ouverture ===", JSON.stringify(opened, null, 2)?.slice(0, 4000));
console.log("turnstile vu:", turnstileSeen);
console.log("état après:", await freeLeft());
await page.waitForTimeout(5000);
await context.close();
process.exit(0);

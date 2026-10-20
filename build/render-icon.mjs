/**
 * Rend build/KYARA BOT.svg en build/icon.png (1024×1024, fond transparent).
 * Prérequis : `npx playwright install chromium` (une fois).
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "KYARA BOT.svg"), "utf8");
const SIZE = 1024;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; width: ${SIZE}px; height: ${SIZE}px; background: transparent; overflow: hidden; }
      svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
    </style>
  </head>
  <body>${svg}</body>
</html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({
    path: join(here, "icon.png"),
    omitBackground: true,
    clip: { x: 0, y: 0, width: SIZE, height: SIZE },
  });
  console.log(`build/icon.png rendu en ${SIZE}×${SIZE} depuis build/KYARA BOT.svg`);
} finally {
  await browser.close();
}

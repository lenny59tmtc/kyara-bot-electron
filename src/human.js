export async function humanClick(page, locator, opts = {}) {
  const DBG = !!process.env.TRADE_DEBUG;
  const t0 = Date.now();
  let tScroll = 0;
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2500 });
    await page.waitForTimeout(20 + Math.random() * 40);
  } catch (e) {
    tScroll = Date.now() - t0;
    if (DBG) console.log(`[debug] scroll KO ${tScroll} ms: ${String(e?.message || e).split("\n")[0]}`);
  }
  if (DBG && !tScroll) tScroll = Date.now() - t0;

  let box = await locator.boundingBox().catch(() => null);
  const tBox = Date.now();
  let samples = 0;
  for (let i = 0; i < 5 && box && box.width && box.height; i++) {
    await page.waitForTimeout(15 + Math.random() * 25);
    const next = await locator.boundingBox().catch(() => null);
    samples++;
    if (!next || !next.width || !next.height) {
      box = null;
      break;
    }
    const moved =
      Math.abs(next.x - box.x) +
      Math.abs(next.y - box.y) +
      Math.abs((next.width || 0) - (box.width || 0)) +
      Math.abs((next.height || 0) - (box.height || 0));
    box = next;
    if (moved < 6) break;
  }
  const tStable = Date.now() - tBox;

  if (box && box.width && box.height) {
    const tx = box.x + box.width * (0.3 + Math.random() * 0.4);
    const ty = box.y + box.height * (0.3 + Math.random() * 0.4);
    const sx = 180 + Math.random() * 760;
    const sy = 140 + Math.random() * 520;
    const tMove = Date.now();
    await page.mouse.move(sx, sy);
    const t1 = Date.now();
    await page.mouse.move(sx + (tx - sx) * 0.4, sy + (ty - sy) * 0.4 + (Math.random() * 30 - 15), { steps: 6 });
    const t2 = Date.now();
    await page.mouse.move(tx, ty, { steps: 8 + Math.floor(Math.random() * 8) });
    const t3 = Date.now();
    const moveMs = t3 - tMove;
    if (DBG) console.log(`[debug] moves: aléa=${t1 - tMove} m2=${t2 - t1} cible=${t3 - t2} (départ ${Math.round(sx)},${Math.round(sy)} → cible ${Math.round(tx)},${Math.round(ty)})`);
    await page.mouse.down();
    await page.waitForTimeout(18 + Math.random() * 32);
    await page.mouse.up();
    if (DBG) console.log(`[debug] humanClick total=${Date.now() - t0} ms (scroll=${tScroll} stab=${tStable} samples=${samples} move=${moveMs})`);
    return true;
  }
  const tc = Date.now();
  await locator.click(opts);
  if (DBG) console.log(`[debug] humanClick(fallback) total=${Date.now() - t0} ms click=${Date.now() - tc}`);
  return true;
}

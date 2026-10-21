import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const CATALOG_TTL = 24 * 3600 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let catalogCache = null;

export async function loadCatalog(bot) {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.map;
  try {
    const st = fs.statSync(CATALOG_PATH);
    if (Date.now() - st.mtimeMs < CATALOG_TTL) {
      catalogCache = { at: Date.now(), map: JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) };
      return catalogCache.map;
    }
  } catch {}

  const list = await bot.api("/characters");
  if (list?.error) {
    throw new Error(/rate_limited/.test(list.error) ? "rate_limited" : `catalogue indisponible: ${list.error}`);
  }
  if (!Array.isArray(list) || !list.length) throw new Error("catalogue indisponible");
  const map = {};
  for (const c of list) map[c.id] = c;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(map));
  } catch {}
  catalogCache = { at: Date.now(), map };
  return map;
}

export async function getDuplicates(bot) {
  if (bot.state?.authenticated === false) throw new Error("auth_required");
  if (typeof bot.ensureOnSite === "function") await bot.ensureOnSite();
  const collection = await bot.api("/me/collection");
  if (collection?.error) {
    if (/rate_limited/.test(collection.error)) throw new Error("rate_limited");
    throw new Error(`collection indisponible: ${collection.error}`);
  }
  if (!Array.isArray(collection)) throw new Error("collection indisponible (connecte le bot)");
  const dupes = collection.filter((i) => i.qty > 1);
  // Petites pauses irrégulières entre les appels : évite un rythme de bot.
  await sleep(220 + Math.random() * 480);
  const catalog = await loadCatalog(bot);
  await sleep(160 + Math.random() * 420);

  let mine = { listings: [] };
  try {
    mine = await bot.api("/me/market");
  } catch {}
  const listed = new Set((mine.listings || []).filter((l) => l.status === "active").map((l) => l.character?.id));

  let totalValue = 0;
  let sellableCount = 0;

  const rows = dupes.map((d) => {
    const ch = catalog[d.characterId] || {};
    const p = d.prices || {};
    const extras = Math.max(0, d.listable ?? Math.max(0, d.qty - 1));
    const ref = p.median7d || p.median30d || p.lastPrice || null;

    // Analyse basée uniquement sur les prix déjà renvoyés par /me/collection :
    // aucune requête /market/listings par personnage (source du rate limit).
    const advice = ref != null ? Math.max(1, Math.round(ref)) : null;
    let logic = "aucune donnée";
    if (p.median7d) logic = "médiane 7j (collection)";
    else if (p.median30d) logic = "médiane 30j (collection)";
    else if (p.lastPrice) logic = "dernière vente (collection)";

    const quick = advice ? Math.max(1, Math.round(advice * 0.75)) : null;
    const demand = p.sales7d ?? 0;
    const saturated = false;
    const state = d.sellBlock ? `bloqué: ${d.sellBlock}` : listed.has(d.characterId) ? "déjà en vente" : extras > 0 ? "vendable" : "non listable";

    if (advice && extras > 0 && state === "vendable") {
      totalValue += advice * extras;
      sellableCount += extras;
    }

    return {
      characterId: d.characterId,
      name: ch.name || `#${d.characterId}`,
      native: ch.native || "",
      series: ch.series || "",
      image: ch.image || "",
      rarity: ch.rarity || "?",
      pow: ch.pow ?? null,
      qty: d.qty,
      extras,
      median7d: p.median7d ?? null,
      median30d: p.median30d ?? null,
      lastPrice: p.lastPrice ?? null,
      lastAt: p.lastAt ?? null,
      sales7d: demand,
      sales30d: p.sales30d ?? 0,
      lowestAsk: null,
      listings: 0,
      advice,
      quick,
      logic,
      saturated,
      state,
      firstAt: d.firstAt,
    };
  });

  rows.sort((a, b) => (b.advice || 0) * b.extras - (a.advice || 0) * a.extras || b.sales7d - a.sales7d);

  return {
    at: new Date().toISOString(),
    rows,
    summary: {
      characters: rows.length,
      extras: rows.reduce((total, row) => total + (row.extras || 0), 0),
      sellable: sellableCount,
      potential: totalValue,
    },
  };
}

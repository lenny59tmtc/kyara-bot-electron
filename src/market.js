import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const CATALOG_TTL = 24 * 3600 * 1000;
const MARKET_TTL = 3 * 60 * 1000;

let catalogCache = null;
let marketCache = { at: 0, map: {} };

export function clearMarketCache() {
  marketCache = { at: 0, map: {} };
}

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

async function marketSnapshot(bot, ids) {
  const missing = ids.filter((id) => !(id in marketCache.map));
  if (missing.length) {
    const fresh = await bot.page.evaluate(async (ids) => {
      const token = localStorage.getItem("kyara_token");
      const headers = {
        authorization: `Bearer ${token}`,
        "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
      };
      const out = {};
      let cursor = 0;
      const worker = async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const r = await fetch(`/api/market/listings?characterId=${id}&pageSize=5&sort=price_asc`, { headers });
              if (r.status === 429) {
                await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
                continue;
              }
              const j = await r.json();
              const items = (j.items || []).filter((x) => x.status === "active");
              const prices = items
                .map((x) => x.buyoutPrice ?? x.price ?? x.currentBid)
                .filter((x) => typeof x === "number" && x > 0);
              out[id] = { lowest: prices.length ? Math.min(...prices) : null, count: items.length };
              break;
            } catch {
              out[id] = { lowest: null, count: 0, error: true };
              break;
            }
            await new Promise((s) => setTimeout(s, 400));
          }
          if (!(id in out)) out[id] = { lowest: null, count: 0, error: true };
          await new Promise((s) => setTimeout(s, 100));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return out;
    }, missing);
    Object.assign(marketCache.map, fresh);
    marketCache.at = Date.now();
  }
  return marketCache.map;
}

export async function getDuplicates(bot) {
  const collection = await bot.api("/me/collection");
  if (!Array.isArray(collection)) throw new Error("collection indisponible (connecte le bot)");
  const dupes = collection.filter((i) => i.qty > 1);
  const catalog = await loadCatalog(bot);
  const market = await marketSnapshot(bot, dupes.map((d) => d.characterId));

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
    const m = market[d.characterId] || {};
    const extras = Math.max(0, d.listable ?? Math.max(0, d.qty - 1));
    const ref = p.median7d || p.median30d || p.lastPrice || null;
    const lowest = m.lowest ?? null;

    let advice = null;
    let logic = "aucune donnée";
    if (lowest != null && ref != null) {
      advice = Math.max(1, Math.min(ref, lowest - 1));
      logic = lowest - 1 <= ref ? `sous la plus basse annonce (${lowest})` : `médiane 7j (${ref})`;
    } else if (lowest != null) {
      advice = Math.max(1, lowest - 1);
      logic = `sous la plus basse annonce (${lowest})`;
    } else if (ref != null) {
      advice = ref;
      logic = p.median7d ? "aucune annonce en cours → médiane 7j" : "aucune annonce en cours → dernière vente";
    }

    const quick = advice ? Math.max(1, Math.round(advice * 0.75)) : null;
    const demand = p.sales7d ?? 0;
    const saturated = lowest != null && ref != null && lowest < ref * 0.7;
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
      lowestAsk: lowest,
      listings: m.count ?? 0,
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
      extras: rows.reduce((s, r) => s + r.qty, 0),
      sellable: sellableCount,
      potential: totalValue,
    },
  };
}

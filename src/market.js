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

async function marketSnapshot(bot, ids) {
  if (!bot.page || bot.page.isClosed()) throw new Error("browser_closed");
  if (!bot.page.url().startsWith("https://kyara.games")) throw new Error("auth_required");
  // Le cache expire réellement (auparavant MARKET_TTL n'était pas utilisé).
  if (Date.now() - marketCache.at > MARKET_TTL) {
    marketCache = { at: 0, map: {} };
  }
  const missing = ids.filter((id) => !(id in marketCache.map));
  if (!missing.length) return marketCache.map;

  const fresh = await bot.page.evaluate(async (ids) => {
    const token = localStorage.getItem("kyara_token");
    const headers = {
      authorization: `Bearer ${token}`,
      "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
    };
    const out = {};
    let cursor = 0;
    let limited = false;
    let retryAfterMs = 90000;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const worker = async () => {
      while (!limited && cursor < ids.length) {
        const id = ids[cursor++];
        let ok = false;
        for (let attempt = 0; attempt < 2 && !limited; attempt++) {
          try {
            const r = await fetch(`/api/market/listings?characterId=${id}&pageSize=5&sort=price_asc`, { headers });
            if (r.status === 429) {
              const retry = Number(r.headers.get("retry-after")) || 0;
              if (attempt === 0) {
                await sleep(2200 + Math.random() * 1000);
                continue;
              }
              limited = true;
              retryAfterMs = Math.max(60000, retry * 1000);
              break;
            }
            if (!r.ok) {
              await sleep(350);
              continue;
            }
            const j = await r.json();
            const items = (j.items || []).filter((x) => x.status === "active");
            const prices = items
              .map((x) => x.buyoutPrice ?? x.price ?? x.currentBid)
              .filter((x) => typeof x === "number" && x > 0);
            out[id] = { lowest: prices.length ? Math.min(...prices) : null, count: items.length };
            ok = true;
          } catch {
            await sleep(350);
          }
        }
        if (!ok && !limited) out[id] = { lowest: null, count: 0, error: true };
        // Étalement des requêtes pour éviter de déclencher le rate limit.
        await sleep(220 + Math.random() * 180);
      }
    };

    // Deux workers maximum : plus doux pour l'API que l'ancienne version (3).
    await Promise.all([worker(), worker()]);
    if (limited) return { __rateLimited: true, retryAfterMs };
    return out;
  }, missing);

  if (fresh?.__rateLimited) {
    bot.noteRateLimit?.(fresh.retryAfterMs || 90000);
    throw new Error("rate_limited");
  }
  delete fresh?.__rateLimited;
  Object.assign(marketCache.map, fresh);
  marketCache.at = Date.now();
  return marketCache.map;
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

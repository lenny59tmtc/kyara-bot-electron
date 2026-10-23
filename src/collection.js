import { RECYCLE_MIN } from "./config.js";
import { loadCatalog } from "./market.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let collectionCache = { at: 0, data: null };
const COLLECTION_TTL = 10000;

export function invalidateCollection() {
  collectionCache = { at: 0, data: null };
}

/** Collection complète avec les infos carte et la valeur de recyclage. */
export async function getCollectionOverview(bot, { force = false } = {}) {
  if (bot.state?.authenticated !== true) throw new Error("auth_required");
  if (!force && collectionCache.data && Date.now() - collectionCache.at < COLLECTION_TTL) {
    return collectionCache.data;
  }
  if (typeof bot.ensureOnSite === "function") await bot.ensureOnSite();
  const collection = await bot.api("/me/collection?lean=1");
  if (collection?.error) {
    if (/rate_limited/.test(collection.error)) throw new Error("rate_limited");
    throw new Error(`collection indisponible: ${collection.error}`);
  }
  if (!Array.isArray(collection)) throw new Error("collection indisponible (connecte le bot)");
  const catalog = await loadCatalog(bot);
  const rows = [];
  for (const item of collection) {
    const qty = Number(item?.qty) || 0;
    if (qty <= 0) continue;
    const character = catalog[Number(item.characterId)];
    if (!character) continue;
    const rarity = character.rarity || "?";
    const value = RECYCLE_MIN[rarity] ?? 1;
    rows.push({
      characterId: Number(item.characterId),
      name: character.name || `#${item.characterId}`,
      series: character.series || "Sans série",
      rarity,
      image: character.image || null,
      qty,
      locked: Number(item.locked) || 0,
      listable: Number(item.listable) || 0,
      recycleValue: value,
      totalValue: value * qty,
    });
  }
  rows.sort((a, b) => {
    const rarity = String(a.rarity).localeCompare(String(b.rarity));
    if (rarity !== 0) return rarity;
    return String(a.series).localeCompare(String(b.series), "fr") || String(a.name).localeCompare(String(b.name), "fr");
  });
  const data = {
    at: new Date().toISOString(),
    rows,
    summary: {
      cards: rows.reduce((total, row) => total + row.qty, 0),
      distinct: rows.length,
      value: rows.reduce((total, row) => total + row.totalValue, 0),
      duplicates: rows.filter((row) => row.qty > 1).length,
    },
  };
  collectionCache = { at: Date.now(), data };
  return data;
}

/**
 * Recycle une sélection de cartes, une par une, avec de petits délais.
 * Le verrou d'activité est géré par l'appelant.
 */
export async function recycleCards(bot, items) {
  if (bot.state?.authenticated !== true) throw new Error("auth_required");
  const overview = await getCollectionOverview(bot, { force: true });
  const byId = new Map(overview.rows.map((row) => [row.characterId, row]));
  const results = [];
  let totalChakra = 0;
  for (const item of items) {
    const characterId = Number(item?.characterId);
    const row = byId.get(characterId);
    if (!row) {
      results.push({ characterId, ok: false, error: "carte non possédée" });
      continue;
    }
    const requested = Math.max(1, Math.floor(Number(item.qty) || 1));
    const qty = Math.min(requested, row.qty);
    try {
      const result = await bot.recycle(characterId, qty);
      totalChakra += result.chakra || row.recycleValue * qty;
      results.push({
        characterId,
        name: row.name,
        qty,
        ok: true,
        chakra: result.chakra || row.recycleValue * qty,
      });
      bot.log("info", `Recyclage · ${row.name} ×${qty} (+${result.chakra || row.recycleValue * qty} ⚡)`);
    } catch (error) {
      results.push({ characterId, name: row.name, ok: false, error: error?.message || String(error) });
    }
    await sleep(450 + Math.random() * 700);
  }
  invalidateCollection();
  return { results, totalChakra, recycled: results.filter((r) => r.ok).length };
}

import { loadCatalog, invalidateMyMarket } from "./market.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Agrège le catalogue et la collection par série (album d'anime).
 * Tri par défaut : nombre de cartes possédées croissant.
 */
export async function getSeriesOverview(bot) {
  if (bot.state?.authenticated !== true) throw new Error("auth_required");
  if (typeof bot.ensureOnSite === "function") await bot.ensureOnSite();

  const collection = await bot.api("/me/collection?lean=1");
  if (collection?.error) {
    if (/rate_limited/.test(collection.error)) throw new Error("rate_limited");
    throw new Error(`collection indisponible: ${collection.error}`);
  }
  if (!Array.isArray(collection)) throw new Error("collection indisponible (connecte le bot)");

  const catalog = await loadCatalog(bot);
  const ownedById = new Map();
  for (const item of collection) {
    const id = Number(item?.characterId ?? item?.id);
    const qty = Number(item?.qty ?? 0);
    if (Number.isFinite(id) && qty > 0) ownedById.set(id, qty);
  }

  const groups = new Map();
  for (const character of Object.values(catalog)) {
    if (!character || Number(character.id) == null) continue;
    const series = String(character.series || "").trim() || "Sans série";
    let group = groups.get(series);
    if (!group) {
      group = {
        series,
        total: 0,
        owned: 0,
        copies: 0,
        image: null,
        ownedImage: false,
        rarities: {},
      };
      groups.set(series, group);
    }
    const rarity = character.rarity || "?";
    group.rarities[rarity] ||= { total: 0, owned: 0 };
    group.rarities[rarity].total += 1;
    group.total += 1;
    if (!group.image && character.image) group.image = character.image;

    const qty = ownedById.get(Number(character.id)) || 0;
    if (qty > 0) {
      if (!group.ownedImage && character.image) {
        // Priorité à une carte possédée pour l'illustration de l'album.
        group.image = character.image;
        group.ownedImage = true;
      }
      group.owned += 1;
      group.copies += qty;
      group.rarities[rarity].owned += 1;
    }
  }

  const rows = [...groups.values()]
    .map((group) => {
      const completion = group.total ? Math.round((group.owned / group.total) * 100) : 0;
      return {
        ...group,
        missing: Math.max(0, group.total - group.owned),
        completion,
        completed: group.total > 0 && group.owned >= group.total,
      };
    })
    // Ordre croissant du nombre de cartes possédées (puis taille de l'album).
    .sort((a, b) => a.owned - b.owned || a.total - b.total || a.series.localeCompare(b.series, "fr"));

  const ownedRows = rows.filter((row) => row.owned > 0);
  return {
    at: new Date().toISOString(),
    rows,
    summary: {
      series: rows.length,
      ownedSeries: ownedRows.length,
      completed: rows.filter((row) => row.completed).length,
      ownedCards: ownedRows.reduce((total, row) => total + row.owned, 0),
      copies: ownedRows.reduce((total, row) => total + row.copies, 0),
    },
  };
}

/**
 * Achète directement les annonces fixes les moins chères pour les cartes
 * manquantes d'une série, dans la limite du prix et du nombre demandés.
 */
export async function buyMissingForSeries(bot, seriesName, { maxPrice, limit = 3 } = {}) {
  if (bot.state?.authenticated !== true) throw new Error("auth_required");
  const target = String(seriesName || "").trim();
  if (!target) throw new Error("série manquante");
  if (typeof bot.ensureOnSite === "function") await bot.ensureOnSite();

  const collection = await bot.api("/me/collection?lean=1");
  if (!Array.isArray(collection)) throw new Error("collection indisponible");
  const owned = new Set(
    collection.filter((item) => Number(item?.qty) > 0).map((item) => Number(item.characterId)),
  );
  const catalog = await loadCatalog(bot);
  const missing = Object.values(catalog).filter(
    (character) =>
      String(character.series || "").trim() === target && !owned.has(Number(character.id)),
  );
  const budget = Math.max(1, Number(maxPrice) || Number(bot.config.buyMaxPrice) || 20);
  const maxCount = Math.min(5, Math.max(1, Number(limit) || 3));
  const results = [];

  for (const character of missing.slice(0, maxCount)) {
    const characterId = Number(character.id);
    try {
      const response = await bot.api(
        `/market/listings?characterId=${characterId}&type=fixed&sort=price_asc&pageSize=10`,
      );
      if (response?.error) throw new Error(response.error);
      const items = Array.isArray(response?.items) ? response.items : [];
      const listing = items.find(
        (item) =>
          item?.id &&
          String(item.status || "").toLowerCase() === "active" &&
          Number(item.price) <= budget &&
          (!item.seller?.id || item.seller.id !== bot.state.userId),
      );
      if (!listing) {
        results.push({
          characterId,
          name: character.name,
          ok: false,
          reason: "aucune annonce dans le budget",
        });
        continue;
      }
      await bot.buyListing(listing.id);
      results.push({
        characterId,
        name: character.name,
        ok: true,
        price: Number(listing.price) || 0,
        listingId: listing.id,
      });
      bot.log("info", `Série ${target} · achat ${character.name} pour ${listing.price} ⚡`);
      invalidateMyMarket();
      await sleep(1600 + Math.random() * 2200);
    } catch (error) {
      results.push({ characterId, name: character.name, ok: false, reason: error?.message || String(error) });
    }
  }
  return { series: target, results, bought: results.filter((result) => result.ok).length };
}

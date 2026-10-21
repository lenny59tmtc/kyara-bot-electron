import { loadCatalog } from "./market.js";

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

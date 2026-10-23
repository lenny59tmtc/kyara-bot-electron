import { loadCatalog, getMyMarket, invalidateMyMarket } from "./market.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_PAGES = 6;
const PAGE_SIZE = 50;

function seriesKey(series) {
  return String(series || "").trim() || "Sans série";
}

export class BuyerWorker {
  constructor(bot) {
    this.bot = bot;
    this.running = false;
    this.loopPromise = null;
    this.history = [];
    this.state = {
      running: false,
      phase: "idle",
      candidates: 0,
      ordersPlaced: 0,
      lastError: null,
      lastOrder: null,
      nextAt: null,
      strategy: "completion",
      history: [],
    };
    this.lastLog = 0;
  }

  snapshot() {
    return {
      ...this.state,
      history: this.history.slice(0, 12),
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.state.running = true;
    this.loopPromise = this.loop().catch((error) => {
      this.state.phase = "error";
      this.state.lastError = error?.message || String(error);
      this.bot.log("warn", `Achats · moteur arrêté: ${this.state.lastError}`);
      this.running = false;
      this.state.running = false;
    });
  }

  async stop() {
    this.running = false;
    this.state.running = false;
    this.state.phase = "idle";
  }

  async idle(ms) {
    let left = ms;
    while (left > 0 && this.running && this.bot.config.autoBuy === true) {
      const step = Math.min(left, 500);
      await sleep(step);
      left -= step;
    }
  }

  resolveInterval() {
    const min = Math.max(30, Number(this.bot.config.buyIntervalMin) || 90);
    const max = Math.max(min, Number(this.bot.config.buyIntervalMax) || 240);
    return (min + Math.random() * (max - min)) * 1000;
  }

  /** Cartes manquantes + prix observés + complétion de chaque série. */
  async collectCandidates() {
    if (this.bot.state?.authenticated !== true) throw new Error("auth_required");
    if (typeof this.bot.ensureOnSite === "function") await this.bot.ensureOnSite();
    const collection = await this.bot.api("/me/collection?lean=1");
    if (!Array.isArray(collection)) throw new Error("collection indisponible");
    const catalog = await loadCatalog(this.bot);
    const owned = new Set(
      collection
        .filter((item) => Number(item?.qty) > 0)
        .map((item) => Number(item.characterId)),
    );

    const series = new Map();
    const missing = [];
    for (const character of Object.values(catalog)) {
      if (!character || Number(character.id) == null) continue;
      const name = seriesKey(character.series);
      let group = series.get(name);
      if (!group) {
        group = { total: 0, owned: 0 };
        series.set(name, group);
      }
      group.total += 1;
      if (owned.has(Number(character.id))) {
        group.owned += 1;
      } else {
        missing.push(character);
      }
    }
    for (const group of series.values()) {
      group.completion = group.total ? (group.owned / group.total) * 100 : 0;
    }
    const missingIds = new Set(missing.map((card) => Number(card.id)));

    // Prix les plus bas observés sur les annonces fixes, pour les cartes manquantes.
    const prices = new Map();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await this.bot.api(
        `/market/listings?type=fixed&sort=price_asc&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      if (response?.error) {
        if (/rate_limited/.test(response.error)) throw new Error("rate_limited");
        break;
      }
      const items = Array.isArray(response?.items) ? response.items : [];
      if (!items.length) break;
      for (const listing of items) {
        const characterId = Number(listing?.character?.id);
        if (!characterId || !missingIds.has(characterId)) continue;
        if (listing?.status && listing.status !== "active") continue;
        if (listing?.seller?.id && this.bot.state?.userId && listing.seller.id === this.bot.state.userId) continue;
        const price = Number(listing.price);
        if (!(price > 0)) continue;
        const current = prices.get(characterId);
        if (!current || price < current) prices.set(characterId, price);
      }
      if (items.length < PAGE_SIZE) break;
      await sleep(350 + Math.random() * 450);
    }

    // Ordres d'achat déjà en cours : ne pas les dupliquer.
    let openOrders = new Set();
    try {
      const market = await getMyMarket(this.bot);
      openOrders = new Set((market.openBuyOrders || []).map((order) => Number(order.characterId)));
    } catch {}

    const maxPrice = Math.max(1, Number(this.bot.config.buyMaxPrice) || 20);
    const candidates = missing
      .map((character) => {
        const price = prices.get(Number(character.id));
        if (!price || price > maxPrice) return null;
        if (openOrders.has(Number(character.id))) return null;
        const group = series.get(seriesKey(character.series)) || { completion: 0 };
        return {
          characterId: Number(character.id),
          name: character.name || `#${character.id}`,
          series: seriesKey(character.series),
          rarity: character.rarity || "?",
          image: character.image || null,
          price: Math.round(price),
          completion: Math.round(group.completion),
        };
      })
      .filter(Boolean);

    const priority = this.bot.config.buyPriority || "completion";
    this.state.strategy = priority;
    candidates.sort((a, b) => {
      if (priority === "cheapest") return a.price - b.price || b.completion - a.completion;
      if (priority === "balanced") {
        const score = (candidate) => candidate.price + (100 - candidate.completion) * 0.25;
        return score(a) - score(b);
      }
      // completion : les séries les plus proches d'être complétées d'abord.
      return b.completion - a.completion || a.price - b.price;
    });
    return candidates;
  }

  async placeOrder(candidate) {
    const result = await this.bot.createBuyOrder(candidate.characterId, candidate.price);
    this.state.ordersPlaced += 1;
    this.state.lastOrder = {
      at: new Date().toISOString(),
      characterId: candidate.characterId,
      name: candidate.name,
      price: candidate.price,
      series: candidate.series,
      completion: candidate.completion,
    };
    this.history.unshift({ ...this.state.lastOrder, ok: true });
    this.history = this.history.slice(0, 40);
    this.bot.log(
      "info",
      `Achats · ordre d'achat ${candidate.name} à ${candidate.price} ⚡ (${candidate.series})`,
    );
    return result;
  }

  async cycle() {
    this.state.phase = "scan";
    this.state.lastError = null;
    const candidates = await this.collectCandidates();
    this.state.candidates = candidates.length;
    if (!candidates.length) {
      this.state.phase = "idle";
      return { placed: 0, total: 0, wait: this.resolveInterval() };
    }
    this.state.phase = "achat";
    const maxPerRun = Math.min(5, Math.max(1, Number(this.bot.config.buyMaxPerRun) || 2));
    let placed = 0;
    for (const candidate of candidates.slice(0, maxPerRun)) {
      if (!this.running || this.bot.config.autoBuy !== true) break;
      await this.placeOrder(candidate);
      placed += 1;
      invalidateMyMarket();
      await sleep(2500 + Math.random() * 3500);
    }
    this.state.phase = placed ? "cooldown" : "idle";
    return { placed, total: candidates.length, wait: this.resolveInterval() };
  }

  async loop() {
    await sleep(8000 + Math.random() * 7000);
    while (this.running) {
      if (this.bot.config.autoBuy !== true) {
        this.state.phase = "idle";
        await sleep(5000);
        continue;
      }
      if (!this.bot.state.authenticated) {
        this.state.phase = "waiting_login";
        await sleep(5000);
        continue;
      }
      try {
        // Toute la passe d'achat est exclusive : pas d'ouverture/vente en parallèle.
        const run = await this.bot.runExclusive("achat", () => this.cycle());
        if (run.skipped) {
          this.state.phase = `attente (${run.activity})`;
          await this.idle(4000);
          continue;
        }
        const result = run.value;
        const wait = result.wait || this.resolveInterval();
        this.state.nextAt = new Date(Date.now() + wait).toISOString();
        if (result.total > 0 || result.placed > 0) {
          this.bot.log(
            "info",
            `Achats · ${result.placed}/${result.total} ordre(s) d'achat placé(s) — prochain passage dans ${Math.round(wait / 1000)} s`,
          );
        }
        await this.idle(wait);
      } catch (error) {
        this.state.phase = "error";
        this.state.lastError = error?.message || String(error);
        this.bot.log("warn", `Achats · ${this.state.lastError}`);
        await this.idle(60000);
      }
    }
    this.state.phase = "idle";
  }
}

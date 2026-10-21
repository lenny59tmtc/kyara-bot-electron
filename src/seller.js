import { RARITY_ORDER, RECYCLE_MIN } from "./config.js";
import { appendSale, loadSales } from "./store.js";
import { getDuplicates } from "./market.js";
import { bus } from "./bus.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STRATEGY_LABELS = {
  fast: "Vite",
  normal: "Normal",
  patient: "Patient",
};

/**
 * Met automatiquement en vente les doublons du compte.
 * - désactivée par défaut (config.autoSell === false) ;
 * - respecte la rareté max, la stratégie de prix et le délai aléatoire ;
 * - détecte les annonces vendues via /me/market pour le bilan de chakra.
 */
export class SellerWorker {
  constructor(bot) {
    this.bot = bot;
    this.running = false;
    this.loopPromise = null;
    this.soldIds = new Set();
    this.listedById = new Map();
    this.primed = false;
    this.lastNoDupLog = 0;
    this.lastSoldCheck = 0;
    this.state = {
      running: false,
      enabled: false,
      phase: "idle",
      candidates: 0,
      listedThisRun: 0,
      lastAt: null,
      last: null,
      lastSoldAt: null,
      lastError: null,
      nextAt: null,
      strategy: null,
      maxRarity: null,
      activeListings: 0,
      pendingChakra: 0,
      noDuplicates: false,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  async start() {
    if (this.running) return;
    this.loadExisting();
    this.running = true;
    this.state.running = true;
    this.loopPromise = this.loop().catch((error) => {
      this.state.phase = "error";
      this.state.lastError = error?.message || String(error);
      this.bot.log("warn", `Ventes · moteur arrêté: ${this.state.lastError}`);
      this.running = false;
      this.state.running = false;
    });
  }

  async stop() {
    this.running = false;
    this.state.running = false;
    this.state.phase = "idle";
  }

  loadExisting() {
    try {
      for (const sale of loadSales(3000)) {
        if (sale.kind === "sold" && sale.listingId) this.soldIds.add(sale.listingId);
        else if (sale.listingId) this.listedById.set(sale.listingId, sale);
      }
    } catch {}
  }

  async idle(ms, stopIfDisabled = false) {
    let left = ms;
    while (left > 0 && this.running && (!stopIfDisabled || this.bot.config.autoSell === true)) {
      const step = Math.min(left, 250);
      await sleep(step);
      left -= step;
    }
  }

  async loop() {
    while (this.running) {
      const cfg = this.bot.config;
      this.state.enabled = cfg.autoSell === true;
      this.state.strategy = cfg.sellPricing || "normal";
      this.state.maxRarity = cfg.sellMaxRarity || "R";

      if (this.bot.isRateLimited?.()) {
        this.state.phase = "rate_limited";
        this.state.nextAt = null;
        await this.idle(12000);
        continue;
      }

      if (!this.state.enabled) {
        this.state.phase = "disabled";
        this.state.candidates = 0;
        this.state.nextAt = null;
        this.state.noDuplicates = false;
        this.lastNoDupLog = 0;
        // Le bilan continue de suivre les ventes (même manuelles) toutes les 2 min.
        if (this.bot.state.authenticated && Date.now() - this.lastSoldCheck > 120000) {
          try {
            await this.bot.ensureBrowser();
            await this.checkSoldListings();
            this.lastSoldCheck = Date.now();
          } catch {}
        }
        await this.idle(5000);
        continue;
      }
      if (!this.bot.state.authenticated) {
        this.state.phase = "waiting_login";
        this.state.nextAt = null;
        await this.idle(5000);
        continue;
      }

      try {
        await this.bot.ensureBrowser();
        this.state.phase = "scan";
        this.state.lastError = null;
        await this.checkSoldListings();

        const candidates = await this.collectCandidates(cfg);
        this.state.candidates = candidates.length;
        this.state.noDuplicates = candidates.length === 0;

        if (!candidates.length) {
          this.state.phase = "idle";
          this.state.nextAt = new Date(Date.now() + 60000).toISOString();
          if (Date.now() - this.lastNoDupLog > 10 * 60 * 1000) {
            this.lastNoDupLog = Date.now();
            this.bot.log("info", "Ventes · aucun doublon éligible à vendre pour l'instant");
          }
          await this.idle(60000);
          continue;
        }

        this.state.phase = "selling";
        this.state.listedThisRun = 0;
        const seen = new Set();
        for (const row of candidates) {
          if (!this.running || this.bot.config.autoSell !== true || !this.bot.state.authenticated) break;
          if (seen.has(row.characterId)) continue;
          seen.add(row.characterId);

          const cfgNow = this.bot.config;
          const price = this.priceFor(row, cfgNow.sellPricing);
          const result = await this.bot.sell(row.characterId, price, {
            rarity: row.rarity,
            name: row.name,
            type: cfgNow.saleType,
            durationHours: cfgNow.saleDurationHours,
          });

          if (result?.ok) {
            const record = appendSale({
              kind: "listed",
              listingId: result.listing?.id ?? null,
              characterId: row.characterId,
              name: row.name,
              rarity: row.rarity,
              price: result.price,
              strategy: cfgNow.sellPricing || "normal",
              type: result.type,
              durationHours: result.durationHours,
              qty: row.qty,
              extras: row.extras,
            });
            if (record.listingId) this.listedById.set(record.listingId, record);
            this.state.listedThisRun++;
            this.state.last = record;
            this.state.lastAt = record.at;
            this.bot.log(
              "info",
              `Ventes · ${row.name} mis en vente à ${result.price} ⚡ (${STRATEGY_LABELS[cfgNow.sellPricing] || "Normal"})`,
            );
            bus.emit("state", this.bot.snapshot());
          } else {
            this.state.lastError = result?.message || result?.error || "vente refusée";
            this.bot.log("warn", `Ventes · échec pour ${row.name}: ${this.state.lastError}`);
            if (result?.error === "pass_required") {
              await this.idle(15000, true);
              continue;
            }
            if (["not_listable", "already_listed", "guest_limit"].includes(result?.error)) {
              continue;
            }
            await this.idle(5000);
          }

          const min = Math.max(5, Number(cfgNow.sellDelayMin) || 30);
          const max = Math.max(min, Number(cfgNow.sellDelayMax) || 90);
          const wait = Math.round((min + Math.random() * (max - min)) * 1000);
          this.state.nextAt = new Date(Date.now() + wait).toISOString();
          await this.idle(wait, true);
        }

        this.state.phase = "idle";
        this.state.nextAt = new Date(Date.now() + 60000).toISOString();
        await this.idle(60000, true);
      } catch (error) {
        this.state.phase = "error";
        this.state.lastError = error?.message || String(error);
        this.bot.log("warn", `Ventes · ${this.state.lastError}`);
        await this.idle(15000);
      }
    }
    this.state.phase = "idle";
    this.state.candidates = 0;
  }

  async collectCandidates(cfg) {
    if (typeof this.bot.ensureOnSite === "function") await this.bot.ensureOnSite();
    const data = await getDuplicates(this.bot);
    const rows = data?.rows || [];
    const maxRank = RARITY_ORDER.indexOf(cfg.sellMaxRarity || "R");
    const limit = maxRank === -1 ? RARITY_ORDER.indexOf("R") : maxRank;
    return rows
      .filter((row) => {
        const rank = RARITY_ORDER.indexOf(row.rarity);
        if (rank === -1 || rank > limit) return false;
        if (row.state !== "vendable" || row.advice == null) return false;
        if (!row.extras || row.extras <= 0) return false;
        return true;
      })
      .sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity);
        const rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return (b.advice || 0) - (a.advice || 0);
      });
  }

  priceFor(row, strategy) {
    const floor = RECYCLE_MIN[row.rarity] ?? 1;
    const base =
      Number(row.advice) ||
      Number(row.median7d) ||
      Number(row.lastPrice) ||
      Number(row.lowestAsk) ||
      floor;
    let price = base;
    if (strategy === "fast") {
      price = row.quick ?? Math.max(floor, Math.round(base * 0.75));
    } else if (strategy === "patient") {
      const reference = Number(row.median7d) || base;
      price = Math.max(base, Math.round(reference * 1.08));
      if (row.lowestAsk != null) price = Math.min(price, Number(row.lowestAsk));
    }
    return Math.max(floor, Math.round(price));
  }

  async checkSoldListings() {
    if (!this.bot.page || this.bot.page.isClosed()) return;
    if (!this.bot.page.url().startsWith("https://kyara.games")) return;
    const mine = await this.bot.api("/me/market");
    const listings = Array.isArray(mine?.listings) ? mine.listings : [];
    this.lastSoldCheck = Date.now();

    // Au premier scan, on mémorise les ventes déjà soldées sans les compter :
    // le bilan horaire démarre à partir des ventes détectées après activation.
    if (!this.primed) {
      for (const listing of listings) {
        if (listing?.isMine && listing.status === "sold" && listing.id) this.soldIds.add(listing.id);
      }
      this.primed = true;
    }

    let detected = 0;

    for (const listing of listings) {
      if (!listing?.isMine || listing.status !== "sold" || !listing.id) continue;
      if (this.soldIds.has(listing.id)) continue;
      const listed = this.listedById.get(listing.id);
      const price = Number(listing.finalPrice ?? listing.price) || listed?.price || 0;
      const record = appendSale({
        kind: "sold",
        listingId: listing.id,
        characterId: listing.character?.id ?? listed?.characterId ?? null,
        name: listing.character?.name ?? listed?.name ?? "?",
        rarity: listing.character?.rarity ?? listed?.rarity ?? "?",
        price,
        strategy: listed?.strategy ?? "manual",
        soldAt: listing.endsAt ?? null,
        detectedAt: new Date().toISOString(),
      });
      this.soldIds.add(listing.id);
      this.state.lastSoldAt = record.at;
      detected++;
      this.bot.log("info", `Ventes · ${record.name} vendu pour ${price} ⚡`);
    }

    const active = listings.filter((listing) => listing?.isMine && listing.status === "active");
    this.state.activeListings = active.length;
    this.state.pendingChakra = active.reduce(
      (total, listing) => total + (Number(listing.buyoutPrice ?? listing.price) || 0),
      0,
    );
    if (detected) bus.emit("state", this.bot.snapshot());
  }
}

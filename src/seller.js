import { RARITY_ORDER, RECYCLE_MIN } from "./config.js";
import { appendSale, loadSales } from "./store.js";
import { getDuplicates, getMyMarket, invalidateMyMarket } from "./market.js";
import { analyzeSellStrategies } from "./strategy.js";
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
    this.analysisCache = { at: 0, value: null };
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
      maxListings: 10,
      pendingChakra: 0,
      noDuplicates: false,
      countKnown: false,
      limitLoggedAt: 0,
      stealth: true,
      sessionListed: 0,
      canceledThisRun: 0,
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

  random(min, max) {
    return min + Math.random() * (max - min);
  }

  randInt(min, max) {
    return Math.floor(this.random(min, max + 1));
  }

  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // Activité « humaine » avant une vente : souris qui se déplace, petit scroll.
  async humanActivity() {
    if (this.bot.config.sellStealth === false) return;
    try {
      const page = this.bot.page;
      if (!page || page.isClosed() || !page.url().startsWith("https://kyara.games")) return;
      const viewport = page.viewportSize() || { width: 1280, height: 800 };
      const moves = this.randInt(1, 3);
      for (let i = 0; i < moves; i++) {
        const x = 30 + Math.random() * Math.max(60, viewport.width - 60);
        const y = 30 + Math.random() * Math.max(60, viewport.height - 60);
        await page.mouse.move(x, y, { steps: this.randInt(4, 13) }).catch(() => {});
        await sleep(this.randInt(90, 320));
      }
      if (Math.random() < 0.3) {
        await page.mouse.wheel(0, this.randInt(-80, 180)).catch(() => {});
        await sleep(this.randInt(150, 450));
      }
    } catch {}
  }

  // Prix très légèrement variable (±3 %) pour éviter des annonces identiques.
  jitterPrice(price, rarity) {
    if (this.bot.config.sellStealth === false) return price;
    const floor = RECYCLE_MIN[rarity] ?? 1;
    const pct = (Math.random() - 0.5) * 0.06;
    return Math.max(floor, Math.round(price * (1 + pct)));
  }

  sessionPauseMs() {
    // Pause entre deux sessions de vente : 2 à 7 minutes, jamais fixe.
    return this.randInt(120000, 420000);
  }

  scanPauseMs() {
    if (this.bot.config.sellStealth === false) return 60000;
    return this.randInt(45000, 115000);
  }

  saleWaitMs(cfg) {
    const configuredMin = Math.max(5, Number(cfg.sellDelayMin) || 30);
    const configuredMax = Math.max(configuredMin, Number(cfg.sellDelayMax) || 90);
    if (cfg.sellStealth === false) {
      return Math.round(this.random(configuredMin, configuredMax) * 1000);
    }
    // Mode discret : plancher de 25 s, marge haute +35 %, jitter log-normal,
    // et pauses occasionnelles plus longues.
    const min = Math.max(25, configuredMin);
    const max = Math.max(min, Math.round(configuredMax * 1.35));
    let wait = this.random(min, max) * 1000;
    wait *= 0.8 + Math.random() * 0.7;
    if (Math.random() < 0.18) wait += this.randInt(10000, 45000);
    if (this.state.sessionListed > 0 && this.state.sessionListed >= this.randInt(3, 6)) {
      wait += this.randInt(60000, 180000);
    }
    return Math.round(wait);
  }

  async loop() {
    while (this.running) {
      const cfg = this.bot.config;
      this.state.enabled = cfg.autoSell === true;
      this.state.strategy = cfg.sellPricing || "normal";
      this.state.maxRarity = cfg.sellMaxRarity || "R";
      this.state.stealth = cfg.sellStealth !== false;

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

      // Une seule activité à la fois : on laisse la main à l'ouverture, aux
      // achats ou aux échanges avant de scanner le marché.
      if (this.bot.activity) {
        this.state.phase = `attente (${this.bot.activity})`;
        await this.idle(3000);
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
        if (typeof this.bot.ensureOnSite === "function") await this.bot.ensureOnSite();
        this.state.phase = "scan";
        this.state.lastError = null;
        await this.checkSoldListings();

        const maxListings = Number(this.bot.state.marketMaxListings) || this.state.maxListings || 10;
        this.state.maxListings = maxListings;
        // Ne jamais tenter une vente quand la limite d'annonces actives est atteinte.
        if (this.state.activeListings >= maxListings) {
          this.state.phase = "limit";
          const wait = this.scanPauseMs();
          this.state.nextAt = new Date(Date.now() + wait).toISOString();
          if (Date.now() - this.limitLoggedAt > 5 * 60 * 1000) {
            this.limitLoggedAt = Date.now();
            this.bot.log(
              "info",
              `Ventes · limite de ${maxListings} annonces actives atteinte — aucune nouvelle vente`,
            );
          }
          await this.idle(wait, true);
          continue;
        }

        const candidates = await this.collectCandidates(cfg);
        this.state.candidates = candidates.length;
        this.state.noDuplicates = candidates.length === 0;

        if (!candidates.length) {
          this.state.phase = "idle";
          const wait = this.scanPauseMs();
          this.state.nextAt = new Date(Date.now() + wait).toISOString();
          if (Date.now() - this.lastNoDupLog > 10 * 60 * 1000) {
            this.lastNoDupLog = Date.now();
            this.bot.log("info", "Ventes · aucun doublon éligible à vendre pour l'instant");
          }
          await this.idle(wait, true);
          continue;
        }

        this.state.phase = "selling";
        this.state.listedThisRun = 0;
        this.state.sessionListed = 0;
        const sessionLimit = this.state.stealth ? this.randInt(2, 6) : candidates.length;
        if (this.state.stealth) {
          await this.humanActivity();
          await this.idle(this.randInt(1200, 4000), true);
        }
        const seen = new Set();
        for (const row of candidates) {
          if (!this.running || this.bot.config.autoSell !== true || !this.bot.state.authenticated) break;
          if (this.state.activeListings >= this.state.maxListings) {
            this.state.phase = "limit";
            break;
          }
          if (this.state.stealth && this.state.sessionListed >= sessionLimit) {
            const pause = this.sessionPauseMs();
            this.state.phase = "cooldown";
            this.state.nextAt = new Date(Date.now() + pause).toISOString();
            this.bot.log(
              "info",
              `Ventes · pause discrète de ${Math.round(pause / 1000)} s après ${this.state.sessionListed} annonce(s)`,
            );
            await this.idle(pause, true);
            break;
          }
          if (seen.has(row.characterId)) continue;
          seen.add(row.characterId);

          if (this.state.stealth) {
            await this.humanActivity();
            await this.idle(this.randInt(1500, 4500), true);
          }

          const cfgNow = this.bot.config;
          const strategy = this.resolveStrategy(cfgNow);
          this.state.strategy = strategy;
          let price = this.priceFor(row, strategy);
          if (this.state.stealth) price = this.jitterPrice(price, row.rarity);
          const sale = await this.bot.runExclusive("vente", () =>
            this.bot.sell(row.characterId, price, {
              rarity: row.rarity,
              name: row.name,
              type: cfgNow.saleType,
              durationHours: cfgNow.saleDurationHours,
            }),
          );
          if (sale.skipped) {
            this.state.phase = `attente (${sale.activity})`;
            break;
          }
          const result = sale.value;

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
              stealth: this.state.stealth,
            });
            if (record.listingId) this.listedById.set(record.listingId, record);
            this.state.listedThisRun++;
            this.state.sessionListed++;
            // Compteur local incrémenté immédiatement ; le prochain scan fait foi.
            this.state.activeListings += 1;
            invalidateMyMarket();
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

          const wait = this.saleWaitMs(cfgNow);
          this.state.nextAt = new Date(Date.now() + wait).toISOString();
          await this.idle(wait, true);
        }

        this.state.phase = "idle";
        const rescanWait = this.scanPauseMs();
        this.state.nextAt = new Date(Date.now() + rescanWait).toISOString();
        await this.idle(rescanWait, true);
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

  /**
   * Ordonne les doublons par chakra attendu décroissant : les cartes qui
   * rapportent le plus sont vendues en premier. À valeur égale, l'ordre est
   * mélangé pour ne pas être parfaitement déterministe.
   */
  orderCandidates(rows, cfg) {
    const strategy = cfg?.sellPricing || "normal";
    const priced = rows.map((row) => ({ row, price: this.priceFor(row, strategy) }));
    priced.sort((a, b) => {
      if (b.price !== a.price) return b.price - a.price;
      const advice = (Number(b.row.advice) || 0) - (Number(a.row.advice) || 0);
      if (advice !== 0) return advice;
      const rank = RARITY_ORDER.indexOf(a.row.rarity) - RARITY_ORDER.indexOf(b.row.rarity);
      if (rank !== 0) return rank;
      return String(a.row.name || "").localeCompare(String(b.row.name || ""), "fr");
    });
    for (let start = 0; start < priced.length; ) {
      let end = start + 1;
      while (end < priced.length && priced[end].price === priced[start].price) end++;
      if (end - start > 1) {
        const group = priced.slice(start, end);
        this.shuffle(group);
        for (let index = 0; index < group.length; index++) priced[start + index] = group[index];
      }
      start = end;
    }
    return priced.map((entry) => entry.row);
  }

  async collectCandidates(cfg) {
    if (typeof this.bot.ensureOnSite === "function") await this.bot.ensureOnSite();
    const data = await getDuplicates(this.bot);
    const rows = data?.rows || [];
    const maxRank = RARITY_ORDER.indexOf(cfg.sellMaxRarity || "R");
    const limit = maxRank === -1 ? RARITY_ORDER.indexOf("R") : maxRank;
    const eligible = rows.filter((row) => {
      const rank = RARITY_ORDER.indexOf(row.rarity);
      if (rank === -1 || rank > limit) return false;
      if (row.state !== "vendable" || row.advice == null) return false;
      if (!row.extras || row.extras <= 0) return false;
      return true;
    });
    const strategy = this.resolveStrategy(cfg);
    this.state.strategy = strategy;
    return this.orderCandidates(eligible, { ...cfg, sellPricing: strategy });
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

  /**
   * Stratégie réellement utilisée : celle de la config, ou la plus rapide
   * observée dans l'historique des ventes si sellPricing = "auto".
   */
  resolveStrategy(cfg) {
    if (cfg?.sellPricing !== "auto") return cfg?.sellPricing || "normal";
    if (!this.analysisCache.value || Date.now() - this.analysisCache.at > 60000) {
      try {
        this.analysisCache = { at: Date.now(), value: analyzeSellStrategies(loadSales(5000)) };
      } catch {
        this.analysisCache = { at: Date.now(), value: { recommended: "normal" } };
      }
    }
    return this.analysisCache.value?.recommended || "normal";
  }

  async cancelOldListings(activeListings) {
    const maxAgeHours = Math.max(1, Number(this.bot.config.sellMaxAgeHours) || 2);
    const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
    const stale = activeListings
      .filter((listing) => {
        const created = new Date(listing?.createdAt || 0).getTime();
        return listing?.id && Number.isFinite(created) && created > 0 && created < cutoff;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 3);
    let canceled = 0;
    for (const listing of stale) {
      const result = await this.bot.runExclusive("vente", () => this.bot.cancelListing(listing.id));
      if (result.skipped) break;
      try {
        await result.value;
        canceled += 1;
        this.state.canceledThisRun += 1;
        this.bot.log(
          "info",
          `Ventes · annonce retirée après ${maxAgeHours} h : ${listing.character?.name || listing.id}`,
        );
      } catch (error) {
        this.bot.log("warn", `Ventes · retrait impossible (${listing.character?.name || listing.id}): ${error.message}`);
      }
      await sleep(900 + Math.random() * 1400);
    }
    if (canceled) invalidateMyMarket();
    return canceled;
  }

  async checkSoldListings() {
    if (!this.bot.page || this.bot.page.isClosed()) return;
    if (!this.bot.page.url().startsWith("https://kyara.games")) return;
    // Comptage frais des annonces actives (source fiable : /me/market).
    const market = await getMyMarket(this.bot, { force: true });
    const listings = market.listings;
    this.lastSoldCheck = Date.now();
    this.state.maxListings = market.maxListings;
    this.state.countKnown = true;

    // Libère les annonces qui ne se vendent pas (2 h par défaut).
    let canceled = 0;
    if (this.bot.config.autoSell === true) {
      canceled = await this.cancelOldListings(market.active);
    }
    this.state.activeListings = Math.max(0, market.activeCount - canceled);

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

    const active = market.active;
    this.state.pendingChakra = active.reduce(
      (total, listing) => total + (Number(listing.buyoutPrice ?? listing.price) || 0),
      0,
    );
    if (detected) {
      invalidateMyMarket();
      bus.emit("state", this.bot.snapshot());
    }
  }
}

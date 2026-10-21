import { appendTrade, isAlertRarity } from "./store.js";
import { loadCatalog } from "./market.js";
import { humanClick } from "./human.js";
import { bus } from "./bus.js";

const BASE = "https://kyara.games";
const BOARD_URL = `${BASE}/marche?onglet=offres`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const jit = (a, b) => Math.round(rnd(a, b));

const MISSING_LABELS = ["que je n'ai pas", "ones i don't have", "ones i dont have", "ones i haven't got"];
const DUPES_LABELS = ["contre mes doublons", "for my duplicates", "against my duplicates"];

const PILL_SEL = "section.board .filters button.pill";
const LI_SEL = "section.board ul.offers li.offer";

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019\u02bc\u00b4\u0060\u02b9]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listableOf(x) {
  if (!x) return 0;
  const qty = Number(x.qty) || 0;
  const raw = x.listable ?? Math.max(0, qty - 1);
  return Math.max(0, Math.min(Number(raw) || 0, qty - 1));
}

export class TradeWorker {
  constructor(bot) {
    this.bot = bot;
    this.page = null;
    this.attached = new WeakSet();
    this.running = false;
    this.loopPromise = null;
    this.watchdog = null;
    this.acceptWaiter = null;
    this.doneIds = new Set();
    this.lastEmptyLog = 0;
    this.state = {
      running: false,
      lastCycleAt: null,
      lastAcceptAt: null,
      accepted: 0,
      cards: 0,
      candidates: 0,
      dialogHandled: 0,
      filters: { missing: false, dupes: false },
      waitingOpening: false,
      lastError: null,
    };
  }

  log(level, msg) {
    this.bot.log(level, `Échanges · ${msg}`);
  }

  snapshot() {
    try {
      return JSON.parse(JSON.stringify(this.state));
    } catch {
      return { ...this.state, filters: { ...this.state.filters } };
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.state.running = true;
    bus.emit("state", this.bot.snapshot());
    this.loopPromise = this.loop().catch((e) => {
      this.log("error", `Procédure interrompue: ${e?.message || e}`);
      this.state.running = false;
      this.running = false;
      bus.emit("state", this.bot.snapshot());
    });
  }

  async stop() {
    this.running = false;
    this.state.running = false;
    this.state.waitingOpening = false;
    this.stopWatchdog();
    this.acceptWaiter?.(null);
    this.acceptWaiter = null;
    const page = this.page;
    this.page = null;
    try {
      if (page && !page.isClosed()) await page.close();
    } catch {}
  }

  async loop() {
    while (this.running) {
      let wait = jit(5000, 8000);
      try {
        if (this.bot.isRateLimited?.()) {
          this.state.filters = { missing: false, dupes: false };
          this.state.candidates = 0;
          if (!(await this.idle(12000))) break;
          continue;
        }
        if (this.bot.config?.tradesAuto === false) {
          this.state.filters = { missing: false, dupes: false };
          this.state.candidates = 0;
          if (!(await this.idle(4000))) break;
          continue;
        }
        if (!this.bot.state?.authenticated) {
          // Compte invité / non connecté : le moteur d'échanges reste en pause.
          this.state.filters = { missing: false, dupes: false };
          this.state.candidates = 0;
          if (!(await this.idle(4000))) break;
          continue;
        }
        if (await this.waitWhileOpening()) break;
        await this.cycle();
        if (Math.random() < 0.12) wait += jit(900, 2600);
      } catch (e) {
        const msg = e?.message || String(e);
        if (msg !== this.state.lastError) {
          this.state.lastError = msg;
          this.log("warn", msg);
        }
        this.state.filters = { missing: false, dupes: false };
        wait = jit(9000, 15000);
      }
      bus.emit("state", this.bot.snapshot());
      if (!this.running) break;
      if (!(await this.idle(wait))) break;
    }
  }

  async idle(ms) {
    let left = ms;
    while (left > 0 && this.running) {
      const step = Math.min(left, 250);
      await sleep(step);
      left -= step;
    }
    return this.running;
  }

  async waitWhileOpening() {
    if (this.bot.opening <= 0) return !this.running;
    this.state.waitingOpening = true;
    bus.emit("state", this.bot.snapshot());
    this.log("info", "Ouverture de booster en cours — pause des échanges");
    while (this.running && this.bot.opening > 0) {
      await sleep(jit(900, 1900));
    }
    this.state.waitingOpening = false;
    bus.emit("state", this.bot.snapshot());
    return !this.running;
  }

  async cycle() {
    const page = await this.ensureTab();
    this.startWatchdog(page);
    try {
      await this.openBoard(page);
      await this.waitForOffers(page);
      await this.applyFilters(page);
      await this.waitForOffers(page);
      const collection = await this.loadCollection(page);
      const offers = await this.readOffers(page);
      const valid = offers.filter((o) => this.matchesFilters(o, collection));
      this.state.lastCycleAt = new Date().toISOString();
      this.state.candidates = valid.length;
      this.state.lastError = null;

      if (!valid.length) {
        if (Date.now() - this.lastEmptyLog > 5 * 60 * 1000) {
          this.lastEmptyLog = Date.now();
          this.log("info", "Aucune annonce correspondante (que je n'ai pas + contre mes doublons)");
        }
        return;
      }
      this.lastEmptyLog = 0;
      this.log("info", `${valid.length} échange(s) disponible(s) — validation immédiate`);
      if (process.env.TRADE_DRY) {
        this.log("info", `[dry] acceptation ignorée (${valid.length} échange(s))`);
        return;
      }
      await this.acceptAll(valid, page, collection);
    } finally {
      this.stopWatchdog();
    }
  }

  async ensureTab() {
    const bot = this.bot;
    await bot.ensureBrowser();
    const ctx = bot.context;
    if (!ctx || ctx.isClosed()) throw new Error("navigateur indisponible");
    if (this.page && !this.page.isClosed()) {
      await this.page.bringToFront().catch(() => {});
      return this.page;
    }

    const pages = ctx.pages().filter((p) => !p.isClosed());
    let p = pages.find((x) => x !== bot.page && x.url().includes("/marche"));
    if (!p) p = pages.find((x) => x !== bot.page && !x.url().startsWith("about:blank"));
    if (!p) p = pages.find((x) => x !== bot.page);
    if (!p) p = await ctx.newPage();

    this.page = p;
    if (!this.attached.has(p)) {
      this.attached.add(p);
      p.on("response", (res) => this.onResponse(res));
      p.on("close", () => {
        if (this.page === p) this.page = null;
      });
    }
    await p.bringToFront().catch(() => {});
    return p;
  }

  onResponse(res) {
    const url = res.url();
    if (!/\/api\/trades\/offers\/[^/?]+\/accept/.test(url)) return;
    Promise.resolve(res
      .json()
      .catch(() => null))
      .then((body) => {
        const w = this.acceptWaiter;
        if (!w) return;
        this.acceptWaiter = null;
        w({ status: res.status(), body });
      })
      .catch(() => {});
  }

  startWatchdog(page) {
    if (this.watchdog) return;
    this.watchdog = setInterval(async () => {
      try {
        if (!this.page || this.page.isClosed()) return;
        const box = this.page.locator(".ts-box").first();
        if (await box.count()) {
          if (process.env.TRADE_DEBUG) console.log("[debug] watchdog: .ts-box détecté, clic anti-Turnstile");
          const frame = this.page.frameLocator(".ts-box iframe").first();
          await frame.locator("body").click({ position: { x: 30, y: 30 }, timeout: 3000 }).catch(() => {});
        }
      } catch {}
    }, 1500);
  }

  stopWatchdog() {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  async openBoard(page) {
    const url = page.url();
    const onBoard = url.includes("/marche") && url.includes("onglet=offres");

    if (!onBoard) {
      await page.goto(BOARD_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(jit(450, 950));
    } else {
      await this.clickTab(page, "Mon activité");
      await page
        .locator("section.board")
        .waitFor({ state: "detached", timeout: 2500 })
        .catch(() => {});
      await this.clickTab(page, "Échanges");
      if (!page.url().includes("onglet=offres")) {
        await page.goto(BOARD_URL, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(jit(450, 950));
      }
    }

    const board = page.locator("section.board").first();
    try {
      await board.waitFor({ timeout: 15000 });
    } catch {
      throw new Error("tableau des échanges introuvable (connexion ou accès marché ?)");
    }
    await page
      .waitForFunction(() => document.querySelectorAll("section.board .filters button.pill").length >= 3, null, { timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(jit(10, 35));
  }

  async clickTab(page, label) {
    const tab = page.locator('button[role="tab"]').filter({ hasText: label }).first();
    if (!(await tab.count().catch(() => 0))) return false;
    await tab.click({ timeout: 3000 }).catch(() => humanClick(page, tab));
    await page.waitForTimeout(jit(50, 120));
    return true;
  }

  async readPills(page) {
    return page.$$eval(PILL_SEL, (els) =>
      els.map((e, i) => ({ i, text: (e.textContent || "").trim(), pressed: e.getAttribute("aria-pressed") })),
    );
  }

  async applyFilters(page) {
    const targets = [
      { key: "missing", labels: MISSING_LABELS },
      { key: "dupes", labels: DUPES_LABELS },
    ];
    for (const t of targets) {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const pills = await this.readPills(page);
        const hit = pills.find((p) => t.labels.includes(norm(p.text)));
        if (!hit) {
          if (process.env.TRADE_DEBUG) console.log(`[debug] ${t.key} essai ${attempt + 1}: pilule introuvable (${pills.map((p) => p.text).join(" | ")})`);
          await page.waitForTimeout(jit(60, 140));
          continue;
        }
        if (hit.pressed !== "true") {
          const tc = Date.now();
          await humanClick(page, page.locator(PILL_SEL).nth(hit.i));
          if (process.env.TRADE_DEBUG) console.log(`[debug] ${t.key} essai ${attempt + 1}: humanClick ${Date.now() - tc} ms`);
          await page.waitForTimeout(jit(20, 60));
        }
        const after = await this.readPills(page);
        ok = (after.find((p) => p.i === hit.i)?.pressed ?? "") === "true";
        if (!ok && process.env.TRADE_DEBUG) console.log(`[debug] ${t.key} essai ${attempt + 1}: vérif KO (pressed=${after.find((p) => p.i === hit.i)?.pressed ?? "absent"})`);
        if (!ok) await page.waitForTimeout(jit(80, 180));
      }
      this.state.filters[t.key] = ok;
      if (!ok) throw new Error(`filtre « ${t.labels[0]} » non sélectionné — échanges suspendus`);
    }
    await page.waitForTimeout(jit(10, 35));
  }

  async waitForOffers(page) {
    await page
      .waitForFunction(
        () => {
          const s = document.querySelector("section.board");
          if (!s) return false;
          if (s.querySelectorAll("ul.offers li.offer").length) return true;
          const t = (s.innerText || "").toLowerCase();
          return t.includes("rien ne correspond") || t.includes("nothing matches");
        },
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
  }

  async loadCollection(page) {
    const col = await page.evaluate(async () => {
      const token = localStorage.getItem("kyara_token");
      if (!token) return null;
      try {
        const r = await fetch("/api/me/collection?lean=1", {
          headers: {
            authorization: `Bearer ${token}`,
            "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
          },
        });
        return await r.json();
      } catch {
        return null;
      }
    });
    const map = new Map();
    if (Array.isArray(col)) for (const c of col) map.set(Number(c.characterId), c);
    return map;
  }

  async readOffers(page) {
    return page.$$eval(LI_SEL, (items) =>
      items.map((li) => {
        const id = String(li.id || "").replace(/^offre-/, "");
        const big = li.querySelector(".give a.big");
        const href = big?.getAttribute("href") || "";
        const cardId = Number(href.match(/\/wiki\/(\d+)/)?.[1] || 0) || null;
        const name = (li.querySelector(".give .gi b")?.textContent || "").trim();
        const who = li.querySelector('.give .gi a[href^="/profil/"]');
        const thumbs = [...li.querySelectorAll(".want .thumbs a.thumb")];
        const have = thumbs.filter((a) => a.classList.contains("have"));
        const giveIds = have
          .map((a) => Number((a.getAttribute("href") || "").match(/\/wiki\/(\d+)/)?.[1] || 0))
          .filter(Boolean);
        const buttons = [...li.querySelectorAll(".acts button.btn-acc")].filter((b) => !b.disabled);
        return {
          id,
          cardId,
          name,
          userId: (who?.getAttribute("href") || "").replace("/profil/", "") || null,
          pseudo: (who?.textContent || "").trim() || null,
          giveIds,
          buttons: buttons.length,
          mine: li.classList.contains("mine"),
        };
      }),
    );
  }

  matchesFilters(offer, collection) {
    if (!offer.id || offer.mine || this.doneIds.has(offer.id)) return false;
    if (!offer.cardId || !offer.giveIds.length || !offer.buttons) return false;
    if ((collection.get(offer.cardId)?.qty ?? 0) > 0) return false;
    return offer.giveIds.some((id) => listableOf(collection.get(id)) > 0);
  }

  async acceptAll(offers, page, collection) {
    let done = 0;
    for (const offer of offers) {
      if (!this.running) break;
      if (this.doneIds.has(offer.id)) continue;

      if (this.bot.opening > 0 && (await this.waitWhileOpening())) break;

      const still = await page.locator(`${LI_SEL}[id="offre-${offer.id}"]`).count().catch(() => 0);
      if (!still) continue;

      const out = await this.acceptOne(page, offer, collection);
      if (out?.ok) {
        this.doneIds.add(offer.id);
        done++;
        await this.record(offer, out.giveId);
        await this.waitGone(page, offer.id);
      } else {
        this.log("warn", `Échange refusé (${offer.name || offer.id}): ${out?.reason || "raison inconnue"}`);
        if (out?.fatal) break;
      }
      await sleep(jit(10, 30));
    }
    if (this.doneIds.size > 400) this.doneIds = new Set([...this.doneIds].slice(-200));
    return done;
  }

  async acceptOne(page, offer, collection) {
    const max = Math.min(offer.giveIds.length, offer.buttons);
    if (max <= 0) return { reason: "aucun doublon libérable" };
    let idx = max - 1;
    let best = -1;
    for (let i = 0; i < max; i++) {
      const qty = Number(collection.get(offer.giveIds[i])?.qty) || 1;
      if (qty - 1 > best) {
        best = qty - 1;
        idx = i;
      }
    }
    const li = page.locator(`${LI_SEL}[id="offre-${offer.id}"]`);
    const btn = li.locator(".acts button.btn-acc").nth(idx);
    if (!(await btn.count().catch(() => 0))) return { reason: "bouton d'échange introuvable" };

    const waiter = new Promise((resolve) => {
      this.acceptWaiter = resolve;
    });

    await humanClick(page, btn);

    const t0 = Date.now();
    let res = null;
    while (Date.now() - t0 < 9000) {
      const r = await Promise.race([waiter, sleep(60).then(() => null)]);
      if (r) {
        res = r;
        break;
      }
      await this.maybeConfirm(page);
    }
    if (this.acceptWaiter === waiter) this.acceptWaiter = null;

    if (!res) return { reason: "aucune réponse du serveur" };
    const err = res.body?.error;
    if (res.status >= 400 || err) {
      return {
        reason: err || res.body?.message || `http_${res.status}`,
        fatal: res.status === 403 || err === "market_access" || err === "banned",
      };
    }
    return { ok: true, status: res.status, body: res.body, giveId: offer.giveIds[idx] };
  }

  async maybeConfirm(page) {
    try {
      const dialogs = page.locator('[role="dialog"][aria-modal="true"], section [role="dialog"], .modal, .dialog');
      const n = await dialogs.count();
      if (!n) return false;
      const dlg = dialogs.last();
      const text = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ");
      if (!/(confirmer|valider|échanger|echanger|ne plus demander)/i.test(text)) return false;

      const box = dlg.locator('input[type="checkbox"]').first();
      if (await box.count()) {
        const checked = await box.isChecked().catch(() => false);
        if (!checked) {
          await humanClick(page, box);
          await page.waitForTimeout(25 + Math.random() * 45);
        }
      }

      const btn = dlg.locator("button").filter({ hasText: /(confirmer|valider|échanger|echanger)/i }).first();
      const target = (await btn.count()) ? btn : dlg.locator("button.btn-acc").first();
      if (!(await target.count())) return false;

      await humanClick(page, target);
      this.state.dialogHandled = (this.state.dialogHandled || 0) + 1;
      if (!this.confirmNoted) {
        this.confirmNoted = true;
        this.log("info", "Fenêtre de confirmation traitée — option « Ne plus demander pendant cette session » cochée");
      }
      return true;
    } catch {
      return false;
    }
  }

  async waitGone(page, id) {
    const target = `${LI_SEL}[id="offre-${id}"]`;
    for (let i = 0; i < 16; i++) {
      const still = await page.locator(target).count().catch(() => 0);
      if (!still) return true;
      const buttons = await page.locator(`${target} .acts button.btn-acc`).count().catch(() => 0);
      if (!buttons) return true;
      await sleep(40);
    }
    return false;
  }

  async record(offer, giveId) {
    let catalog = {};
    try {
      catalog = await loadCatalog(this.bot);
    } catch {}
    const ch = catalog[offer.cardId] || {};
    const gave = catalog[giveId] || {};
    const entry = appendTrade({
      offerId: offer.id,
      characterId: offer.cardId,
      name: ch.name || offer.name || `#${offer.cardId}`,
      native: ch.native || "",
      series: ch.series || "",
      rarity: ch.rarity || "?",
      image: ch.image || "",
      gaveId: giveId ?? null,
      gaveName: gave.name || (giveId ? `#${giveId}` : "—"),
      from: offer.pseudo,
      fromId: offer.userId,
      count: 1,
    });
    this.state.accepted++;
    this.state.cards += 1;
    this.state.lastAcceptAt = entry.at;
    this.state.lastError = null;
    const alert = isAlertRarity(entry.rarity);
    this.log(
      alert ? "rare" : "info",
      `Échange accepté: ${entry.name} (${entry.rarity}) contre ${entry.gaveName}${entry.from ? ` — ${entry.from}` : ""}`,
    );
    bus.emit("state", this.bot.snapshot());
    return entry;
  }
}

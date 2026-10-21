import { chromium } from "playwright";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROFILE_DIR, loadConfig, saveConfig, RARITY_ORDER, RECYCLE_MIN } from "./config.js";
import { appendOpening, appendBatch, buildBatchReport, isAlertRarity } from "./store.js";
import { TradeWorker } from "./trades.js";
import { SellerWorker } from "./seller.js";
import { humanClick } from "./human.js";
import { bus } from "./bus.js";

const BASE = "https://kyara.games";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE_LOCK_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort", "lockfile"];

function withTimeout(promise, ms, label = "timeout") {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class KyaraBot {
  constructor() {
    this.config = loadConfig();
    this.context = null;
    this.page = null;
    this.running = false;
    this.loopPromise = null;
    this.pendingOpen = null;
    this.packs = [];
    this.opening = 0;
    this.loginPrompted = false;
    this.lastDupCheck = 0;
    this.rateLimitedUntil = 0;
    this.lastRateLimitLog = 0;
    this.trades = new TradeWorker(this);
    this.seller = new SellerWorker(this);
    this.state = {
      running: false,
      startedAt: null,
      pseudo: null,
      avatar: null,
      chakra: null,
      freePacks: null,
      freePacksMax: null,
      nextFreeAt: null,
      boostersOpened: null,
      pack: this.config.pack,
      batch: null,
      lastBatch: null,
      lastLoggedFree: null,
      lastOpenAt: null,
      lastOpen: null,
      lastError: null,
      authWarned: false,
      version: null,
      authenticated: false,
      guest: false,
      needsLogin: false,
      discordUsername: null,
      autoOpenPaused: false,
      tradesAutoOffReason: null,
      browserOpen: false,
      browserClosed: false,
      rateLimitedUntil: null,
      marketMaxListings: 10,
      log: [],
    };
  }

  log(level, msg) {
    const entry = { at: new Date().toISOString(), level, msg };
    this.state.log.unshift(entry);
    this.state.log = this.state.log.slice(0, 80);
    console.log(`[${level}] ${msg}`);
    bus.emit("log", entry);
    bus.emit("state", this.snapshot());
  }

  snapshot() {
    return JSON.parse(
      JSON.stringify({
        ...this.state,
        config: this.config,
        trade: this.trades?.snapshot() ?? null,
        sell: this.seller?.snapshot() ?? null,
      }),
    );
  }

  isRateLimited() {
    return Date.now() < this.rateLimitedUntil;
  }

  noteRateLimit(retryAfterMs = 60000) {
    const wait = Math.max(15000, Math.min(Number(retryAfterMs) || 60000, 15 * 60 * 1000));
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + wait);
    this.state.rateLimitedUntil = new Date(this.rateLimitedUntil).toISOString();
    if (Date.now() - this.lastRateLimitLog > 30000) {
      this.lastRateLimitLog = Date.now();
      this.log("warn", `API limitée par le serveur — pause de ${Math.ceil(wait / 1000)} s`);
    }
  }

  clearRateLimitIfExpired() {
    if (this.rateLimitedUntil && Date.now() >= this.rateLimitedUntil) {
      this.rateLimitedUntil = 0;
      this.state.rateLimitedUntil = null;
    }
  }

  async start() {
    if (this.running) return;
    this.config = loadConfig();
    this.running = true;
    this.state.running = true;
    this.state.startedAt = new Date().toISOString();
    this.state.pack = this.config.pack;
    this.loopPromise = this.loop().catch((e) => {
      this.log("error", `Bot arrêté: ${e?.message || e}`);
      this.state.running = false;
      this.running = false;
    });
    this.trades.start();
    this.seller.start();
  }

  async stop() {
    this.running = false;
    this.state.running = false;
    this.state.browserOpen = false;
    this.state.browserClosed = false;
    bus.emit("state", this.snapshot());
    await this.seller.stop();
    await this.trades.stop();
    try {
      await this.context?.close();
    } catch {}
    this.context = null;
    this.page = null;
  }

  async ensureBrowser() {
    if (this.browserLaunch) return this.browserLaunch;
    this.browserLaunch = this.doEnsureBrowser().finally(() => {
      this.browserLaunch = null;
    });
    return this.browserLaunch;
  }

  async prepareBrowserProfile() {
    // Tue un éventuel Chromium Playwright résiduel qui verrouille le profil
    // (fréquent après une mise à jour ou un arrêt forcé), puis retire les verrous.
    try {
      if (process.platform === "win32") {
        const profile = PROFILE_DIR.replace(/'/g, "''");
        const command =
          `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*${profile}*' } | ` +
          `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
          windowsHide: true,
          timeout: 15000,
        });
      }
    } catch {}
    this.removeProfileLocks();
  }

  removeProfileLocks() {
    for (const name of PROFILE_LOCK_FILES) {
      try {
        fs.rmSync(path.join(PROFILE_DIR, name), { recursive: true, force: true });
      } catch {}
    }
  }

  killProfileBrowsers() {
    if (process.platform !== "win32") return;
    try {
      const profile = PROFILE_DIR.replace(/'/g, "''");
      const command =
        `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profile}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        windowsHide: true,
        timeout: 15000,
      });
    } catch {}
  }

  pruneProfileBackups() {
    try {
      const parent = path.dirname(PROFILE_DIR);
      const prefix = `${path.basename(PROFILE_DIR)}.bak-`;
      const backups = fs
        .readdirSync(parent)
        .filter((name) => name.startsWith(prefix))
        .sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - 2))) {
        try {
          fs.rmSync(path.join(parent, old), { recursive: true, force: true });
        } catch {}
      }
    } catch {}
  }

  async recoverBrowserProfile() {
    this.log("warn", "Profil Chromium verrouillé ou inutilisable — sauvegarde puis réinitialisation");
    this.killProfileBrowsers();
    this.removeProfileLocks();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${PROFILE_DIR}.bak-${stamp}`;
    let saved = false;
    try {
      fs.renameSync(PROFILE_DIR, backup);
      saved = true;
    } catch {
      try {
        fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      } catch {}
    }
    try {
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
    } catch {}
    this.pruneProfileBackups();
    if (saved) {
      this.log("warn", `Ancien profil sauvegardé dans ${backup} — une reconnexion Discord sera nécessaire`);
    }
  }

  async launchBrowserWithWatchdog() {
    const options = {
      headless: false,
      viewport: { width: 1280 + Math.floor(Math.random() * 160), height: 800 + Math.floor(Math.random() * 120) },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
        "--disable-crash-reporter",
        "--disable-breakpad",
      ],
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      timeout: 30000,
    };

    let settled = false;
    const launchPromise = chromium.launchPersistentContext(PROFILE_DIR, options);
    launchPromise
      .then((ctx) => {
        if (settled) ctx.close().catch(() => {});
      })
      .catch(() => {});

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("browser_launch_timeout")), 35000);
    });
    try {
      const ctx = await Promise.race([launchPromise, timeoutPromise]);
      settled = true;
      return ctx;
    } catch (error) {
      settled = true;
      this.killProfileBrowsers();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async doEnsureBrowser() {
    if (this.context?.isClosed()) {
      this.context = null;
      this.page = null;
      this.state.browserOpen = false;
    }
    if (this.context && !this.context.isClosed()) {
      this.state.browserOpen = true;
      this.state.browserClosed = false;
      if (!this.page || this.page.isClosed()) {
        this.page =
          this.context.pages().find((p) => !p.isClosed() && p !== this.trades?.page) ?? (await this.context.newPage());
        this.attach(this.page);
      }
      if (this.page.url().startsWith("about:blank")) {
        await this.page.goto(BASE, { waitUntil: "domcontentloaded" });
        await this.page.waitForTimeout(1500);
      }
      return;
    }
    this.log("info", "Ouverture du navigateur (profil persistant)…");
    let ctx = null;
    let launchError = null;
    for (let attempt = 1; attempt <= 2 && !ctx; attempt++) {
      try {
        if (attempt === 1) await this.prepareBrowserProfile();
        else await this.recoverBrowserProfile();
        ctx = await this.launchBrowserWithWatchdog();
      } catch (e) {
        launchError = e;
        const first = String(e?.message || e).split("\n")[0];
        this.log("warn", `Lancement du navigateur impossible (essai ${attempt}/2): ${first}`);
        if (attempt < 2) await sleep(1200);
      }
    }
    if (!ctx) throw launchError;
    this.context = ctx;
    this.state.browserOpen = true;
    this.state.browserClosed = false;
    ctx.on("close", () => {
      if (this.context !== ctx) return;
      this.context = null;
      this.page = null;
      this.state.browserOpen = false;
      this.state.browserClosed = true;
      if (this.running) this.log("warn", "Chromium a été fermé — relance automatique programmée");
      bus.emit("state", this.snapshot());
    });
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      const wa = navigator.webdriver;
      if (wa) delete navigator.webdriver;
      const gl = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        const ctx = gl.call(this, type, attrs);
        if (ctx && type === "webgl" && ctx) {
          try {
            ctx.getParameter = new Proxy(ctx.getParameter, {
              apply(target, self, args) {
                const v = Reflect.apply(target, self, args);
                if (args[0] === 37445) return "Intel Inc.";
                if (args[0] === 37446) return "Intel Iris OpenGL Engine";
                return v;
              },
            });
          } catch {}
        }
        return ctx;
      };
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["fr-FR", "fr", "en-US", "en"] });
      window.chrome = window.chrome || { runtime: {} };
    });
    this.page = this.context.pages().find((p) => !p.isClosed() && p !== this.trades?.page) ?? (await this.context.newPage());
    this.attach(this.page);
    await this.page.goto(BASE, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1500);
  }

  attach(page) {
    page.on("response", (res) => this.onResponse(res));
    page.on("close", () => {
      if (this.page === page) {
        this.page = null;
        this.state.browserOpen = Boolean(this.context && !this.context.isClosed());
        bus.emit("state", this.snapshot());
      }
    });
    page.on("crash", () => {
      if (this.page === page) {
        this.page = null;
        this.state.browserOpen = Boolean(this.context && !this.context.isClosed());
        this.log("warn", "Page Chromium plantée — elle sera recréée automatiquement");
      }
    });
  }

  async api(path) {
    if (this.isRateLimited()) {
      return { error: "rate_limited_local", retryAfterMs: Math.max(0, this.rateLimitedUntil - Date.now()) };
    }
    if (!this.page || this.page.isClosed()) return { error: "browser_closed" };
    let result;
    try {
      result = await withTimeout(
        this.page.evaluate(async (p) => {
          const token = localStorage.getItem("kyara_token");
          if (!token) return { error: "no_token" };
          const r = await fetch("/api" + p, {
            headers: {
              authorization: `Bearer ${token}`,
              "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
            },
          });
          if (r.status === 429) {
            const retry = Number(r.headers.get("retry-after")) || 0;
            return { error: "rate_limited", status: 429, retryAfterMs: retry * 1000 };
          }
          return await r.json().catch(() => ({ error: "bad_json", status: r.status }));
        }, path),
        30000,
        "api_timeout",
      );
    } catch (error) {
      return { error: error?.message || String(error) };
    }
    if (result?.error === "rate_limited") this.noteRateLimit(Number(result.retryAfterMs) || 90000);
    return result;
  }

  async apiPost(path, body) {
    if (this.isRateLimited()) {
      return { error: "rate_limited_local", retryAfterMs: Math.max(0, this.rateLimitedUntil - Date.now()) };
    }
    if (!this.page || this.page.isClosed()) return { error: "browser_closed" };
    let result;
    try {
      result = await withTimeout(
        this.page.evaluate(
          async ({ p, b }) => {
            const token = localStorage.getItem("kyara_token");
            if (!token) return { error: "no_token" };
            const headers = {
              authorization: `Bearer ${token}`,
              "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
              "content-type": "application/json",
            };
            let pass = null;
            try {
              const raw = JSON.parse(localStorage.getItem("kyara_pass") || "null");
              if (raw && raw.expiresAt > Date.now()) pass = raw.pass;
            } catch {}
            if (pass) headers["x-pass"] = pass;
            const r = await fetch("/api" + p, { method: "POST", headers, body: JSON.stringify(b) });
            if (r.status === 429) {
              const retry = Number(r.headers.get("retry-after")) || 0;
              return { error: "rate_limited", status: 429, retryAfterMs: retry * 1000 };
            }
            const j = await r.json().catch(() => ({ error: "bad_json", status: r.status }));
            return { status: r.status, body: j };
          },
          { p: path, b: body },
        ),
        30000,
        "api_timeout",
      );
    } catch (error) {
      return { error: error?.message || String(error) };
    }
    if (result?.error === "rate_limited" || result?.body?.error === "rate_limited") {
      this.noteRateLimit(Number(result.retryAfterMs) || 90000);
    }
    return result;
  }

  async ensurePass() {
    const ok = await this.page.evaluate(() => {
      try {
        const raw = JSON.parse(localStorage.getItem("kyara_pass") || "null");
        return !!(raw && raw.expiresAt > Date.now() + 120000);
      } catch {
        return false;
      }
    });
    if (ok) return true;

    this.log("info", "Laissez-passer expiré: nouvelle vérification…");
    const watchdog = setInterval(async () => {
      try {
        const box = this.page.locator(".ts-box").first();
        if (await box.count()) {
          const frame = this.page.frameLocator(".ts-box iframe").first();
          await frame.locator("body").click({ position: { x: 30, y: 30 }, timeout: 3000 }).catch(() => {});
        }
      } catch {}
    }, 1500);

    try {
      const res = await this.page.evaluate(async () => {
        const token = localStorage.getItem("kyara_token");
        if (!token) return { error: "no_token" };
        const headers = {
          authorization: `Bearer ${token}`,
          "x-device-id": localStorage.getItem("kyara_device") || "no-storage",
        };
        const providers = await fetch("/api/auth/providers", { headers }).then((r) => r.json());
        const sitekey = providers?.turnstile;
        if (!sitekey) return { error: "no_sitekey" };
        const loadTurnstile = () =>
          new Promise((resolve, reject) => {
            if (window.turnstile) return resolve(window.turnstile);
            const s = document.createElement("script");
            s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            s.async = true;
            s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_unavailable")));
            s.onerror = () => reject(new Error("turnstile_unavailable"));
            document.head.appendChild(s);
          });
        let turnstile;
        try {
          turnstile = await loadTurnstile();
        } catch {
          return { error: "turnstile_unavailable" };
        }
        const widget = document.createElement("div");
        widget.className = "ts-box";
        document.body.appendChild(widget);
        const t = await new Promise((resolve, reject) => {
          const id = turnstile.render(widget, {
            sitekey,
            appearance: "interaction-only",
            language: "fr",
            callback: (tok) => {
              try {
                turnstile.remove(id);
              } catch {}
              widget.remove();
              resolve(tok);
            },
            "error-callback": () => {
              widget.remove();
              reject(new Error("turnstile_failed"));
            },
            "timeout-callback": () => {
              widget.remove();
              reject(new Error("turnstile_failed"));
            },
          });
          setTimeout(() => {
            widget.remove();
            reject(new Error("turnstile_timeout"));
          }, 45000);
        });
        const r = await fetch("/api/auth/pass", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ turnstile: t, attempt: 1 }),
        });
        const j = await r.json().catch(() => null);
        if (!j?.pass) return { error: j?.error || `pass_http_${r.status}` };
        localStorage.setItem("kyara_pass", JSON.stringify(j));
        return { ok: true };
      });
      if (!res?.ok) this.log("warn", `Laissez-passer refusé: ${res?.error || "inconnu"}`);
      return !!res?.ok;
    } catch (e) {
      this.log("warn", `Laissez-passer impossible: ${e?.message || e}`);
      return false;
    } finally {
      clearInterval(watchdog);
    }
  }

  async sell(characterId, price, opts = {}) {
    await this.ensureBrowser();
    const min = RECYCLE_MIN[opts.rarity] ?? 1;
    let amount = Math.round(Number(price));
    if (!Number.isFinite(amount) || amount < min) amount = min;
    const type = opts.type === "auction" ? "auction" : "fixed";
    const durationHours = [12, 24, 48].includes(Number(opts.durationHours)) ? Number(opts.durationHours) : (this.config.saleDurationHours ?? 12);

    const body = {
      characterId,
      type,
      price: amount,
      buyoutPrice: type === "auction" ? (opts.buyoutPrice ?? null) : null,
      durationHours,
    };
    let res = await this.apiPost("/market/listings", body);
    if (res?.body?.error === "pass_required" || res?.body?.error === "turnstile_failed") {
      if (await this.ensurePass()) {
        res = await this.apiPost("/market/listings", body);
      } else {
        return { error: "pass_required", message: "Laissez-passer Turnstile indisponible — réessaie dans quelques secondes" };
      }
    }
    if (res?.body?.error) {
      this.log("warn", `Vente refusée (${characterId}): ${res.body.error}${res.body.message ? ` — ${res.body.message}` : ""}`);
      return { error: res.body.error, message: res.body.message };
    }
    this.log("info", `Annonce en ligne: ${opts.name || characterId} à ${amount} ⚡ (${type === "auction" ? "enchère" : "vente directe"}, ${durationHours} h)`);
    bus.emit("state", this.snapshot());
    return { ok: true, listing: res?.body, price: amount, type, durationHours };
  }

  async loop() {
    while (this.running) {
      let waitMs = this.config.pollSeconds * 1000;
      this.clearRateLimitIfExpired();
      if (this.isRateLimited()) {
        // Pause globale : on garde Chromium ouvert et on ne martèle pas l'API.
        this.state.rateLimitedUntil = new Date(this.rateLimitedUntil).toISOString();
        bus.emit("state", this.snapshot());
        await sleep(Math.min(Math.max(1000, this.rateLimitedUntil - Date.now()), 5000));
        continue;
      }
      this.state.rateLimitedUntil = null;
      try {
        await this.ensureBrowser();

        // Pendant le login Discord, la fenêtre n'est plus sur kyara.games :
        // on attend le retour sur le site sans la fermer.
        let page = this.page;
        if (page && !page.isClosed() && !page.url().startsWith(BASE) && this.state.authenticated) {
          // Session connectée mais page redirigée (ex. retour OAuth) : on revient sur le site.
          try {
            await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(1000);
          } catch {}
        }
        page = this.page;
        if (page && !page.isClosed() && !page.url().startsWith(BASE)) {
          this.state.needsLogin = true;
          this.state.authenticated = false;
          waitMs = 3000;
        } else {
          const me = await this.api("/me");
          if (me?.error) throw new Error(`API /me: ${me.error}`);
          this.applyMe(me);
          this.state.authWarned = false;
          this.state.lastError = null;

          if (!this.state.authenticated) {
            // Compte invité créé automatiquement par le site : jamais d'automatisation dessus.
            this.state.needsLogin = true;
            if (!this.loginPrompted) {
              this.loginPrompted = true;
              this.log(
                "warn",
                `Compte invité détecté (${this.state.pseudo || "invité"}) — connexion Discord requise dans la fenêtre Chromium ; les automatismes sont en pause`,
              );
              this.openLogin().catch(() => {});
            }
            waitMs = 5000;
          } else {
            this.loginPrompted = false;
            this.state.needsLogin = false;
            if (!this.packs.length) {
              try {
                this.packs = await this.api("/packs");
              } catch {}
            }

            const opened = await this.tick(me);
            if (opened) {
              waitMs = 4000;
            } else if (me.nextFreeAt) {
              const delta = new Date(me.nextFreeAt).getTime() - Date.now() + 20000;
              waitMs = Math.min(Math.max(delta, 15000), this.config.pollSeconds * 1000);
            }
            await this.maybeDisableTrades();
          }
        }
      } catch (e) {
        const msg = e?.message || String(e);
        if (msg !== this.state.lastError) {
          this.state.lastError = msg;
          this.log("error", msg);
        }
        const onOauthPage = this.page && !this.page.isClosed() && !this.page.url().startsWith(BASE);
        if (/rate_limited/i.test(msg)) {
          // Ne jamais fermer Chromium pour un simple throttling : on attend.
          this.noteRateLimit(Number(e?.retryAfterMs) || 90000);
          waitMs = 5000;
        } else if (msg === "API /me: no_token" || onOauthPage) {
          // Pas connecté / OAuth en cours : on garde la fenêtre ouverte.
          this.state.needsLogin = true;
          this.state.authenticated = false;
          if (!onOauthPage && !this.loginPrompted) {
            this.loginPrompted = true;
            this.log("warn", "Connexion requise — connecte-toi avec Discord dans la fenêtre Chromium ouverte, le bot reprendra automatiquement");
            this.openLogin().catch(() => {});
          }
          waitMs = 3000;
        } else {
          // Erreur transitoire (page fermée, timeout réseau…) : on garde le
          // contexte Chromium ; la boucle recréera la page/le navigateur au besoin.
          if (!this.page || this.page.isClosed()) this.page = null;
          waitMs = 15000;
        }
      }
      bus.emit("state", this.snapshot());
      if (!this.running) break;
      await sleep(waitMs * (0.8 + Math.random() * 0.4));
    }
  }

  async ensureOnSite() {
    await this.ensureBrowser();
    const page = this.page;
    if (!page || page.isClosed()) throw new Error("browser_closed");
    if (!page.url().startsWith(BASE)) {
      if (!this.state.authenticated) throw new Error("auth_required");
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1000);
    }
    return page;
  }

  async restartBrowser() {
    this.log("info", "Redémarrage du navigateur demandé…");
    try {
      await this.context?.close();
    } catch {}
    this.context = null;
    this.page = null;
    this.state.browserOpen = false;
    this.state.browserClosed = false;
    this.rateLimitedUntil = 0;
    this.state.rateLimitedUntil = null;
    await this.ensureBrowser();
    bus.emit("state", this.snapshot());
    return true;
  }

  async openLogin() {
    await this.ensureBrowser();
    const page = this.page;
    if (!page || page.isClosed()) return false;
    try {
      await page.bringToFront();
    } catch {}
    try {
      if (!page.url().startsWith(BASE)) {
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
      }
      const trigger = page.locator('button[aria-label^="Profil de"]').first();
      if (await trigger.count().catch(() => 0)) {
        await trigger.click({ timeout: 4000, force: true }).catch(() => {});
        await page.waitForTimeout(500);
        const discordBtn = page.locator("button", { hasText: /Se connecter avec Discord/i }).first();
        if (await discordBtn.count().catch(() => 0)) {
          await discordBtn.click({ timeout: 4000, force: true }).catch(() => {});
        }
      }
    } catch {}
    return true;
  }

  async maybeDisableTrades() {
    if (this.config.tradesAuto !== true) return;
    const now = Date.now();
    if (now - this.lastDupCheck < 5 * 60 * 1000) return;
    this.lastDupCheck = now;
    try {
      const collection = await this.api("/me/collection?lean=1");
      if (!Array.isArray(collection)) return;
      const duplicates = collection.filter((item) => Number(item.qty) > 1);
      if (duplicates.length > 0) {
        this.state.tradesAutoOffReason = null;
        return;
      }
      this.config = saveConfig({ tradesAuto: false });
      this.state.tradesAutoOffReason = "aucun doublon";
      this.log("info", "Échanges automatiques désactivés : aucun doublon présent sur le compte");
      bus.emit("state", this.snapshot());
    } catch {}
  }

  applyMe(me) {
    this.state.pseudo = me.pseudo ?? this.state.pseudo;
    this.state.avatar = me.discord?.avatar ?? this.state.avatar;
    this.state.chakra = me.chakra;
    this.state.freePacks = me.freePacks;
    this.state.freePacksMax = me.freePacksMax;
    this.state.nextFreeAt = me.nextFreeAt;
    this.state.boostersOpened = me.boostersOpened;
    this.state.discordUsername = me.discord?.username ?? null;
    this.state.guest = !me.discord;
    this.state.authenticated = Boolean(me.discord);
    const maxListings = Number(me.marketLimits?.listings);
    if (Number.isFinite(maxListings) && maxListings > 0) this.state.marketMaxListings = Math.floor(maxListings);
  }

  async tick(me) {
    if (!this.state.authenticated) return false;
    if (this.config.autoOpen === false) {
      if (!this.state.autoOpenPaused) {
        this.state.autoOpenPaused = true;
        this.log("info", "Ouverture automatique désactivée — aucune ouverture de booster ne sera lancée");
      }
      return false;
    }
    if (this.state.autoOpenPaused) this.state.autoOpenPaused = false;
    let opened = false;
    const batchMin = Math.max(2, this.config.batchMin || 6);

    if (this.config.openDaily) {
      const packsState = await this.api("/me/packs");
      const left = packsState?.limits?.daily?.left ?? 0;
      if (left > 0) {
        this.log("info", "Pack du jour disponible, ouverture…");
        opened = !!(await this.openPack("daily", 1)) || opened;
      }
    }

    if (me.freePacks >= batchMin) {
      await this.runBatch(me);
      return true;
    }

    if (me.freePacks > 0 && this.state.lastLoggedFree !== me.freePacks) {
      this.state.lastLoggedFree = me.freePacks;
      this.log("info", `Accumulation: ${me.freePacks} booster(s) gratuits — le multi part entre ${batchMin} et ${Math.max(this.config.batchMax || 8, batchMin)}`);
    }
    return opened;
  }

  pickBatchTarget(freePacks) {
    const min = Math.max(2, this.config.batchMin || 6);
    const max = Math.max(min, this.config.batchMax || 8);
    const upper = Math.min(max, freePacks);
    const lower = Math.min(min, upper);
    return lower + Math.floor(Math.random() * (upper - lower + 1));
  }

  async runBatch(me) {
    this.opening++;
    try {
      return await this.doRunBatch(me);
    } finally {
      this.opening--;
    }
  }

  async doRunBatch(me) {
    const target = this.pickBatchTarget(me.freePacks);
    const before = me.freePacks;
    this.log("rare", `★ Multi-ouverture: ${before} boosters gratuits — objectif ${target} !`);
    this.state.batch = { at: new Date().toISOString(), free: before, target, done: 0 };

    const openings = [];
    let current = me;
    while (this.running && openings.length < target && current.freePacks > 0) {
      const want = Math.min(target - openings.length, current.freePacks);
      const res = await this.openPack(this.config.pack, want);
      if (!res) break;
      openings.push(...res.entries);
      this.state.batch.done = openings.length;
      current = await this.api("/me");
      this.applyMe(current);
      bus.emit("state", this.snapshot());
      if (!(current.freePacks > 0)) break;
      await sleep(2500 + Math.random() * 4000);
    }

    if (this.running && this.config.openDaily) {
      const packsState = await this.api("/me/packs");
      if ((packsState?.limits?.daily?.left ?? 0) > 0) {
        const res = await this.openPack("daily", 1);
        if (res) openings.push(...res.entries);
      }
    }

    this.state.batch = null;
    this.state.lastLoggedFree = null;
    if (!openings.length) {
      this.log("warn", "Multi interrompu: aucune ouverture enregistrée");
      return;
    }

    const report = buildBatchReport(openings, { freePacksBefore: before, target });
    appendBatch(report);
    this.state.lastBatch = report;
    const lines = RARITY_ORDER.filter((r) => report.byRarity[r]).map((r) => `${report.byRarity[r]} ${r}`);
    this.log(
      report.alerts.length ? "rare" : "info",
      `Compte rendu du multi: ${report.boosters} boosters · ${report.cards.length} cartes (${lines.join(", ")}) · ${report.newCards} nouvelles (${report.newUnique} persos)${report.goldens ? ` · ${report.goldens} doré(s)` : ""}${report.godPacks ? ` · ${report.godPacks} pack(s) divin(s)` : ""}`,
    );
    for (const c of report.alerts) {
      this.log("rare", `  ★ ${c.name} (${c.rarity}) — ${c.series}`);
    }
    bus.emit("state", this.snapshot());
  }

  packName(id) {
    return this.packs.find((p) => p.id === id)?.name || id;
  }

  async openPack(packId, want = 1) {
    this.opening++;
    try {
      return await this.doOpenPack(packId, want);
    } finally {
      this.opening--;
    }
  }

  async doOpenPack(packId, want = 1) {
    await this.ensureBrowser();
    if (this.page && !this.page.isClosed()) await this.page.bringToFront().catch(() => {});
    await sleep(300 + Math.random() * 1200);
    const url = `${BASE}/ouvrir/${packId}`;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(2500 + Math.random() * 2500);

    if (!this.packs.length) {
      try {
        this.packs = await this.api("/packs");
      } catch {}
    }

    const btn = this.page.locator("button.btn-open").first();
    try {
      await btn.waitFor({ timeout: 20000 });
    } catch {
      this.log("warn", `Pas de bouton d'ouverture sur ${packId}`);
      return null;
    }

    const label = ((await btn.textContent()) || "").trim().replace(/\s+/g, " ");
    if (!/gratuit|free/i.test(label)) {
      this.log("warn", `Ouverture ignorée sur ${packId}: bouton « ${label} » (pas gratuit)`);
      return null;
    }

    const count = await this.selectFreeCount(packId, want);
    const finalLabel = ((await btn.textContent()) || "").trim().replace(/\s+/g, " ");
    if (!/gratuit|free/i.test(finalLabel)) {
      this.log("warn", `Ouverture annulée sur ${packId}: le site demanderait du chakra (« ${finalLabel} »)`);
      return null;
    }

    await this.page.waitForTimeout(400 + Math.random() * 1500);
    const result = await this.performOpen(finalLabel);
    if (!result) return null;

    const { body } = result;
    const list = Array.isArray(body.results) && body.results.length ? body.results : [body];
    const entries = [];
    let paid = null;

    for (const r of list) {
      if (!Array.isArray(r.cards)) continue;
      if (r.paidWith && r.paidWith !== "free") paid = r.paidWith;
      const entry = appendOpening({
        packId: r.packId || packId,
        packName: this.packName(r.packId || packId),
        cards: r.cards,
        golden: !!r.golden,
        godPack: !!r.godPack,
        pity: !!r.pity,
        paidWith: r.paidWith || "free",
        shareId: r.shareId || null,
        freePacksLeft: r.user?.freePacks ?? null,
        chakra: r.user?.chakra ?? null,
        boostersOpened: r.user?.boostersOpened ?? null,
        label: finalLabel,
      });
      entries.push(entry);
      if (r.user) this.applyMe(r.user);
    }

    if (paid) this.log("error", `⚠ Ouverture payée en ${paid} — du chakra a été dépensé`);
    if (!entries.length) return null;

    this.state.lastOpenAt = entries[entries.length - 1].at;
    this.state.lastOpen = entries[entries.length - 1];
    this.state.lastError = null;

    const alert = entries.some((e) => e.golden || e.godPack || e.cards.some((c) => isAlertRarity(c.rarity)));
    const sound = entries.some((e) => e.godPack || e.cards.some((c) => isAlertRarity(c.rarity)));
    const god = entries.some((e) => e.godPack);
    const best = entries
      .flatMap((e) => e.cards)
      .sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
    this.log(
      alert ? "rare" : "info",
      `Ouvert: ${entries.length} × ${entries[0].packName} · ${entries.length * entries[0].cards.length} cartes · meilleure: ${best ? `${best.name} (${best.rarity})` : "—"}`,
    );
    if (sound && this.config.soundOnRare) (god ? beepGod : beep)();
    bus.emit("state", this.snapshot());
    await sleep(400 + Math.random() * 900);
    return { count: entries.length, entries };
  }

  async humanClick(locator, opts = {}) {
    return humanClick(this.page, locator, opts);
  }

  async selectFreeCount(packId, want) {
    if (packId === "daily") {
      const x1 = this.page.locator("button", { hasText: /^×1$/ }).first();
      if (await x1.count()) await this.humanClick(x1).catch(() => {});
      return 1;
    }

    const me = await this.api("/me");
    if (me && !me.error) this.applyMe(me);
    const free = this.state.freePacks ?? 0;
    const budget = Math.max(1, Math.min(want, free, 10));
    if (budget <= 1) {
      const x1 = this.page.locator("button", { hasText: /^×1$/ }).first();
      if (await x1.count()) await this.humanClick(x1).catch(() => {});
      return 1;
    }

    const options = await this.page.$$eval("button", (els) =>
      [...new Set(els.map((e) => Number((e.textContent || "").trim().match(/^×(\d+)$/)?.[1] || 0)).filter((n) => n >= 1))],
    );
    const feasible = options.filter((n) => n <= budget);
    const count = feasible.length ? Math.max(...feasible) : 1;

    if (count > 1) {
      const target = this.page.locator("button", { hasText: new RegExp(`^×${count}$`) }).first();
      if (await target.count()) await this.humanClick(target).catch(() => {});
      await this.page.waitForTimeout(400 + Math.random() * 800);
    } else {
      const x1 = this.page.locator("button", { hasText: /^×1$/ }).first();
      if (await x1.count()) await this.humanClick(x1).catch(() => {});
    }
    return count;
  }

  performOpen(label) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        this.log("warn", `Délai dépassé pour l'ouverture (${label})`);
        resolve(null);
      }, 90000);

      const watchdog = setInterval(async () => {
        try {
          const box = this.page.locator(".ts-box").first();
          if (await box.count()) {
            const frame = this.page.frameLocator(".ts-box iframe").first();
            await frame.locator("body").click({ position: { x: 30, y: 30 }, timeout: 3000 }).catch(() => {});
          }
        } catch {}
      }, 1500);

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(watchdog);
        if (this.pendingOpen === resolver) this.pendingOpen = null;
      };

      const resolver = (res) => {
        cleanup();
        resolve(res);
      };
      this.pendingOpen = resolver;

      this.humanClick(this.page.locator("button.btn-open").first())
        .catch((e) => {
          cleanup();
          this.log("warn", `Clic impossible: ${e.message.slice(0, 80)}`);
          resolve(null);
        });
    });
  }

  async onResponse(res) {
    const url = res.url();
    if (!url.includes("/open")) return;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const ok = body && (Array.isArray(body.cards) || Array.isArray(body.results));
    if (!ok) {
      if (body?.error) this.log("warn", `Serveur: ${body.error}${body.message ? ` — ${body.message}` : ""}`);
      else if (body) this.log("warn", `Réponse d'ouverture inattendue: ${Object.keys(body).join(", ")}`);
      const p = this.pendingOpen;
      this.pendingOpen = null;
      p?.(null);
      return;
    }
    const p = this.pendingOpen;
    this.pendingOpen = null;
    p?.({ status: res.status(), body });
  }
}

function rank(r) {
  return ["C", "U", "R", "E", "L", "M"].indexOf(r);
}

function beep() {
  if (process.platform !== "win32") return;
  try {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[console]::Beep(1050,220); Start-Sleep -Milliseconds 80; [console]::Beep(1400,220); Start-Sleep -Milliseconds 80; [console]::Beep(1750,380)",
      ],
      { windowsHide: true },
      () => {},
    );
  } catch {}
}

function beepGod() {
  if (process.platform !== "win32") return;
  try {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[console]::Beep(900,180); Start-Sleep -Milliseconds 60; [console]::Beep(1200,180); Start-Sleep -Milliseconds 60; [console]::Beep(1500,180); Start-Sleep -Milliseconds 60; [console]::Beep(1900,180); Start-Sleep -Milliseconds 60; [console]::Beep(2400,500)",
      ],
      { windowsHide: true },
      () => {},
    );
  } catch {}
}

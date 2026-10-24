import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR, loadConfig, saveConfig, RARITY_ORDER } from "./config.js";
import { loadHistory, computeStats, loadBatches, loadTrades, tradeBuckets, tradeStats, loadSales, saleStats, appendSale } from "./store.js";
import { getDuplicates, getMyMarket } from "./market.js";
import { getSeriesOverview, buyMissingForSeries } from "./series.js";
import { getCollectionOverview, recycleCards } from "./collection.js";
import { analyzeSellStrategies } from "./strategy.js";
import { getUpdateState, getAutoUpdateState, requestAutoUpdateRestart, requestAutoUpdateInstall, checkForUpdates } from "./update.js";
import { bus } from "./bus.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function getFreshAutoUpdateState() {
  const auto = getAutoUpdateState();
  if (!auto) return null;
  const current = getUpdateState().currentVersion;
  // Un état écrit par une version précédente ne doit pas alimenter le bouton.
  if (auto.currentVersion && current && auto.currentVersion !== current) return null;
  return auto;
}

export function createServer(bot) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (url.pathname.startsWith("/api/")) {
      Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    }

    if (url.pathname === "/api/state") {
      return json(res, bot.snapshot());
    }
    if (url.pathname === "/api/update") {
      return json(res, { ...getUpdateState(), auto: getFreshAutoUpdateState() });
    }
    if (url.pathname === "/api/update/restart" && req.method === "POST") {
      return json(res, requestAutoUpdateRestart());
    }
    if (url.pathname === "/api/update/check" && req.method === "POST") {
      const result = await checkForUpdates();
      return json(res, { ...result, auto: getFreshAutoUpdateState() });
    }
    if (url.pathname === "/api/update/install" && req.method === "POST") {
      return json(res, requestAutoUpdateInstall());
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      try {
        const ok = await bot.openLogin();
        return json(res, { ok: Boolean(ok) });
      } catch (e) {
        return json(res, { ok: false, error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/history") {
      const limit = Number(url.searchParams.get("limit")) || 100;
      const history = loadHistory(limit);
      return json(res, { history, stats: computeStats(loadHistory(5000)) });
    }
    if (url.pathname === "/api/batches") {
      return json(res, { batches: loadBatches(Number(url.searchParams.get("limit")) || 30) });
    }
    if (url.pathname === "/api/trades") {
      const all = loadTrades(2000);
      const limit = Number(url.searchParams.get("limit")) || 200;
      return json(res, {
        trades: all.slice(0, limit),
        buckets: tradeBuckets(all),
        stats: tradeStats(all),
        auto: bot.config?.tradesAuto !== false,
        state: bot.trades?.snapshot() ?? null,
      });
    }
    if (url.pathname === "/api/sales") {
      const allSales = loadSales(20000);
      let market = null;
      try {
        if (bot.state?.authenticated && bot.page && !bot.page.isClosed()) {
          const snapshot = await getMyMarket(bot);
          market = {
            activeListings: snapshot.activeCount,
            maxListings: snapshot.maxListings,
            totalListings: snapshot.total,
            soldListings: snapshot.soldCount,
          };
        }
      } catch {}
      return json(res, {
        stats: saleStats(allSales),
        history: allSales.slice(0, 300),
        seller: bot.seller?.snapshot() ?? null,
        market,
        strategy: analyzeSellStrategies(allSales),
        auto: bot.config?.autoSell === true,
      });
    }
    if (url.pathname === "/api/duplicates") {
      try {
        await bot.ensureBrowser();
        if (bot.state.authenticated !== true) {
          return json(res, {
            error: "Connexion à Kyara requise : connecte ton compte Discord avant l'analyse de marché.",
            code: "auth_required",
            rows: [],
            summary: { characters: 0, extras: 0, sellable: 0, potential: 0 },
          });
        }
        return json(res, await getDuplicates(bot));
      } catch (e) {
        const message = e?.message || String(e);
        const code = /rate_limited/.test(message)
          ? "rate_limited"
          : /auth_required/.test(message)
            ? "auth_required"
            : /browser_closed/.test(message)
              ? "browser_closed"
              : "market_error";
        return json(res, {
          error: message,
          code,
          retryAfterMs: bot.isRateLimited?.() ? Math.max(0, bot.rateLimitedUntil - Date.now()) : null,
          rows: [],
          summary: { characters: 0, extras: 0, sellable: 0, potential: 0 },
        });
      }
    }
    if (url.pathname === "/api/series") {
      try {
        await bot.ensureBrowser();
        if (bot.state.authenticated !== true) {
          return json(res, {
            error: "Connexion à Kyara requise : connecte ton compte Discord pour voir tes albums.",
            code: "auth_required",
            rows: [],
            summary: { series: 0, ownedSeries: 0, completed: 0, ownedCards: 0, copies: 0 },
          });
        }
        return json(res, await getSeriesOverview(bot));
      } catch (e) {
        const message = e?.message || String(e);
        const code = /rate_limited/.test(message)
          ? "rate_limited"
          : /auth_required/.test(message)
            ? "auth_required"
            : /browser_closed/.test(message)
              ? "browser_closed"
              : "series_error";
        return json(res, {
          error: message,
          code,
          retryAfterMs: bot.isRateLimited?.() ? Math.max(0, bot.rateLimitedUntil - Date.now()) : null,
          rows: [],
          summary: { series: 0, ownedSeries: 0, completed: 0, ownedCards: 0, copies: 0 },
        });
      }
    }
    if (url.pathname === "/api/collection") {
      try {
        await bot.ensureBrowser();
        if (bot.state.authenticated !== true) {
          return json(res, { error: "Connexion à Kyara requise.", code: "auth_required", rows: [], summary: {} });
        }
        return json(res, await getCollectionOverview(bot));
      } catch (e) {
        return json(res, { error: e?.message || String(e), code: "collection_error", rows: [], summary: {} });
      }
    }
    if (url.pathname === "/api/recycle" && req.method === "POST") {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return json(res, { error: "Aucune carte sélectionnée" });
      try {
        await bot.ensureBrowser();
        const run = await bot.runExclusive("recyclage", () => recycleCards(bot, items));
        if (run.skipped) {
          return json(res, { error: `Une autre activité est en cours (${run.activity}) — réessaie dans quelques secondes` });
        }
        return json(res, run.value);
      } catch (e) {
        return json(res, { error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/series/buy" && req.method === "POST") {
      const body = await readBody(req);
      const series = String(body.series || "").trim();
      if (!series) return json(res, { error: "Série manquante" });
      try {
        await bot.ensureBrowser();
        const run = await bot.runExclusive("achat", () =>
          buyMissingForSeries(bot, series, {
            maxPrice: body.maxPrice,
            limit: body.limit,
          }),
        );
        if (run.skipped) {
          return json(res, { error: `Une autre activité est en cours (${run.activity}) — réessaie dans quelques secondes` });
        }
        return json(res, run.value);
      } catch (e) {
        return json(res, { error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/buy/preview") {
      try {
        await bot.ensureBrowser();
        if (bot.state.authenticated !== true) return json(res, { error: "auth_required", candidates: [] });
        return json(res, { candidates: await bot.buyer.collectCandidates(), config: bot.config });
      } catch (e) {
        return json(res, { error: e?.message || String(e), candidates: [] });
      }
    }
    if (url.pathname === "/api/buy") {
      let orders = [];
      try {
        const market = await getMyMarket(bot);
        orders = market.openBuyOrders || [];
      } catch {}
      return json(res, {
        state: bot.buyer?.snapshot() ?? null,
        auto: bot.config?.autoBuy === true,
        orders,
      });
    }
    if (url.pathname === "/api/config" && req.method === "GET") {
      return json(res, loadConfig());
    }
    if (url.pathname === "/api/sell" && req.method === "POST") {
      const body = await readBody(req);
      const characterId = String(body.characterId || "");
      if (!characterId) return json(res, { error: "characterId manquant" });
      try {
        await bot.ensureBrowser();
        const run = await bot.runExclusive("vente", () =>
          bot.sell(Number(characterId), body.price, {
            rarity: body.rarity,
            type: body.type,
            durationHours: body.durationHours,
            name: body.name,
          }),
        );
        if (run.skipped) return json(res, { error: `Une autre activité est en cours (${run.activity})` });
        const out = run.value;
        if (out?.ok) {
          appendSale({
            kind: "listed",
            listingId: out.listing?.id ?? null,
            characterId: Number(characterId),
            name: body.name || `#${characterId}`,
            rarity: body.rarity,
            price: out.price,
            strategy: "manual",
            type: out.type,
            durationHours: out.durationHours,
          });
        }
        return json(res, out);
      } catch (e) {
        return json(res, { error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/config" && req.method === "POST") {
      const body = await readBody(req);
      const patch = {};
      if (typeof body.pack === "string" && /^[a-z0-9\-]+$/.test(body.pack)) patch.pack = body.pack;
      if (typeof body.pollSeconds === "number") patch.pollSeconds = Math.min(Math.max(body.pollSeconds, 15), 600);
      if (typeof body.openDaily === "boolean") patch.openDaily = body.openDaily;
      if (typeof body.soundOnRare === "boolean") patch.soundOnRare = body.soundOnRare;
      if (typeof body.batchMin === "number") patch.batchMin = Math.min(Math.max(Math.round(body.batchMin), 2), 10);
      if (typeof body.batchMax === "number") patch.batchMax = Math.min(Math.max(Math.round(body.batchMax), 2), 10);
      if (body.saleType === "fixed" || body.saleType === "auction") patch.saleType = body.saleType;
      if ([12, 24, 48].includes(Number(body.saleDurationHours))) patch.saleDurationHours = Number(body.saleDurationHours);
      if (typeof body.tradesAuto === "boolean") patch.tradesAuto = body.tradesAuto;
      if (typeof body.autoOpen === "boolean") patch.autoOpen = body.autoOpen;
      if (typeof body.browserBackground === "boolean") patch.browserBackground = body.browserBackground;
      if (typeof body.autoSell === "boolean") patch.autoSell = body.autoSell;
      if (RARITY_ORDER.includes(body.sellMaxRarity)) patch.sellMaxRarity = body.sellMaxRarity;
      if (["fast", "normal", "patient", "auto"].includes(body.sellPricing)) patch.sellPricing = body.sellPricing;
      if (typeof body.sellStealth === "boolean") patch.sellStealth = body.sellStealth;
      if (typeof body.sellMaxAgeHours === "number") {
        patch.sellMaxAgeHours = Math.min(Math.max(Math.round(body.sellMaxAgeHours), 1), 48);
      }
      if (typeof body.autoBuy === "boolean") patch.autoBuy = body.autoBuy;
      if (typeof body.buyMaxPrice === "number") {
        patch.buyMaxPrice = Math.min(Math.max(Math.round(body.buyMaxPrice), 1), 100000);
      }
      if (["cheapest", "completion", "balanced"].includes(body.buyPriority)) patch.buyPriority = body.buyPriority;
      if (typeof body.buyIntervalMin === "number") {
        patch.buyIntervalMin = Math.min(Math.max(Math.round(body.buyIntervalMin), 30), 3600);
      }
      if (typeof body.buyIntervalMax === "number") {
        patch.buyIntervalMax = Math.min(Math.max(Math.round(body.buyIntervalMax), 30), 3600);
      }
      if (typeof body.buyMaxPerRun === "number") {
        patch.buyMaxPerRun = Math.min(Math.max(Math.round(body.buyMaxPerRun), 1), 5);
      }
      if (typeof body.sellDelayMin === "number") {
        patch.sellDelayMin = Math.min(Math.max(Math.round(body.sellDelayMin), 5), 600);
      }
      if (typeof body.sellDelayMax === "number") {
        patch.sellDelayMax = Math.min(Math.max(Math.round(body.sellDelayMax), 5), 600);
      }
      if (patch.sellDelayMin != null || patch.sellDelayMax != null) {
        const current = loadConfig();
        const min = patch.sellDelayMin ?? current.sellDelayMin;
        const max = patch.sellDelayMax ?? current.sellDelayMax;
        patch.sellDelayMin = Math.min(min, max);
        patch.sellDelayMax = Math.max(min, max);
      }
      if (patch.batchMin && !patch.batchMax) {
        const cur = loadConfig();
        if (cur.batchMax < patch.batchMin) patch.batchMax = patch.batchMin;
      }
      const previousBackground = bot.config.browserBackground;
      bot.config = saveConfig(patch);
      bot.state.pack = bot.config.pack;
      if (patch.tradesAuto === true) bot.lastDupCheck = 0;
      bus.emit("state", bot.snapshot());
      if (patch.browserBackground !== undefined && previousBackground !== bot.config.browserBackground && bot.running) {
        // Le mode sans fenêtre / visible nécessite un redémarrage de Chromium.
        setTimeout(() => {
          bot.restartBrowser().catch(() => {});
        }, 700);
      }
      return json(res, bot.config);
    }
    if (url.pathname === "/api/bot/browser/visibility" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const hidden = body.hidden !== false;
        const ok = hidden ? await bot.hideBrowserWindow() : await bot.showBrowserWindow();
        return json(res, { ok, hidden: bot.state.browserHidden === true });
      } catch (e) {
        return json(res, { ok: false, error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/bot/browser/restart" && req.method === "POST") {
      try {
        await bot.restartBrowser();
        return json(res, { ok: true, state: bot.snapshot() });
      } catch (e) {
        return json(res, { ok: false, error: e?.message || String(e) });
      }
    }
    if (url.pathname === "/api/bot/start" && req.method === "POST") {
      await bot.start();
      return json(res, { ok: true });
    }
    if (url.pathname === "/api/bot/stop" && req.method === "POST") {
      await bot.stop();
      return json(res, { ok: true });
    }
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "state", state: bot.snapshot() })}\n\n`);
      const onOpening = (e) => res.write(`data: ${JSON.stringify({ type: "opening", entry: e })}\n\n`);
      const onState = (s) => res.write(`data: ${JSON.stringify({ type: "state", state: s })}\n\n`);
      const onLog = (l) => res.write(`data: ${JSON.stringify({ type: "log", entry: l })}\n\n`);
      const onBatch = (b) => res.write(`data: ${JSON.stringify({ type: "batch", batch: b })}\n\n`);
      const onTrade = (t) => res.write(`data: ${JSON.stringify({ type: "trade", trade: t })}\n\n`);
      const onSale = (s) => res.write(`data: ${JSON.stringify({ type: "sale", sale: s })}\n\n`);
      bus.on("opening", onOpening);
      bus.on("state", onState);
      bus.on("log", onLog);
      bus.on("batch", onBatch);
      bus.on("trade", onTrade);
      bus.on("sale", onSale);
      const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
      req.on("close", () => {
        clearInterval(ping);
        bus.off("opening", onOpening);
        bus.off("state", onState);
        bus.off("log", onLog);
        bus.off("batch", onBatch);
        bus.off("trade", onTrade);
        bus.off("sale", onSale);
      });
      return;
    }

    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });

  return new Promise((resolve) => {
    const port = Number(process.env.PORT) || loadConfig().port;
    server.listen(port, "127.0.0.1", () => {
      console.log(`Interface: http://localhost:${port}`);
      resolve(server);
    });
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(res, data) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR, loadConfig, saveConfig } from "./config.js";
import { loadHistory, computeStats, loadBatches, loadTrades, tradeBuckets, tradeStats } from "./store.js";
import { getDuplicates, clearMarketCache } from "./market.js";
import { getUpdateState, getAutoUpdateState, requestAutoUpdateRestart } from "./update.js";
import { bus } from "./bus.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

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
      return json(res, { ...getUpdateState(), auto: getAutoUpdateState() });
    }
    if (url.pathname === "/api/update/restart" && req.method === "POST") {
      return json(res, requestAutoUpdateRestart());
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
    if (url.pathname === "/api/duplicates") {
      try {
        if (url.searchParams.get("refresh") === "1") clearMarketCache();
        await bot.ensureBrowser();
        return json(res, await getDuplicates(bot));
      } catch (e) {
        return json(res, { error: e?.message || String(e), rows: [], summary: { characters: 0, extras: 0, sellable: 0, potential: 0 } });
      }
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
        const out = await bot.sell(Number(characterId), body.price, {
          rarity: body.rarity,
          type: body.type,
          durationHours: body.durationHours,
          name: body.name,
        });
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
      if (patch.batchMin && !patch.batchMax) {
        const cur = loadConfig();
        if (cur.batchMax < patch.batchMin) patch.batchMax = patch.batchMin;
      }
      bot.config = saveConfig(patch);
      bot.state.pack = bot.config.pack;
      if (patch.tradesAuto === true) bot.lastDupCheck = 0;
      bus.emit("state", bot.snapshot());
      return json(res, bot.config);
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
      bus.on("opening", onOpening);
      bus.on("state", onState);
      bus.on("log", onLog);
      bus.on("batch", onBatch);
      bus.on("trade", onTrade);
      const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
      req.on("close", () => {
        clearInterval(ping);
        bus.off("opening", onOpening);
        bus.off("state", onState);
        bus.off("log", onLog);
        bus.off("batch", onBatch);
        bus.off("trade", onTrade);
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

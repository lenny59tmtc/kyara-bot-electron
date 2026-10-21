import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, RARITY_ORDER } from "./config.js";
import { bus } from "./bus.js";

const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");
const BATCH_PATH = path.join(DATA_DIR, "batches.jsonl");
const TRADE_PATH = path.join(DATA_DIR, "trades.jsonl");
const SALES_PATH = path.join(DATA_DIR, "sales.jsonl");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function appendOpening(entry) {
  ensure();
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry };
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(record) + "\n");
  bus.emit("opening", record);
  return record;
}

export function loadHistory(limit = 200) {
  try {
    const lines = fs.readFileSync(HISTORY_PATH, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendBatch(report) {
  ensure();
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), ...report };
  fs.appendFileSync(BATCH_PATH, JSON.stringify(record) + "\n");
  bus.emit("batch", record);
  return record;
}

export function loadBatches(limit = 50) {
  try {
    const lines = fs.readFileSync(BATCH_PATH, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendTrade(entry) {
  ensure();
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), count: 1, ...entry };
  fs.appendFileSync(TRADE_PATH, JSON.stringify(record) + "\n");
  bus.emit("trade", record);
  return record;
}

export function loadTrades(limit = 300) {
  try {
    const lines = fs.readFileSync(TRADE_PATH, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendSale(entry) {
  ensure();
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), kind: "listed", ...entry };
  fs.appendFileSync(SALES_PATH, JSON.stringify(record) + "\n");
  bus.emit("sale", record);
  return record;
}

export function loadSales(limit = 3000) {
  try {
    const lines = fs.readFileSync(SALES_PATH, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function saleStats(sales = []) {
  const now = Date.now();
  const hour = 3600 * 1000;
  const day = 24 * hour;
  const sold = sales.filter((s) => s.kind === "sold");
  const listed = sales.filter((s) => s.kind !== "sold");
  const priceOf = (s) => Number(s.price) || 0;
  const sum = (rows) => rows.reduce((total, row) => total + priceOf(row), 0);
  const since = (ms) => (s) => now - (Date.parse(s.at) || now) <= ms;

  const lastHour = sold.filter(since(hour));
  const last24h = sold.filter(since(day));
  const todayKey = new Date().toDateString();
  const today = sold.filter((s) => new Date(s.at).toDateString() === todayKey);

  const byRarity = {};
  for (const rarity of RARITY_ORDER) byRarity[rarity] = { count: 0, chakra: 0 };
  for (const sale of sold) {
    const bucket = byRarity[sale.rarity] || (byRarity[sale.rarity] = { count: 0, chakra: 0 });
    bucket.count++;
    bucket.chakra += priceOf(sale);
  }

  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  const buckets = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(hourStart.getTime() - i * hour);
    const end = new Date(start.getTime() + hour);
    const rows = sold.filter((s) => {
      const t = Date.parse(s.at) || 0;
      return t >= start.getTime() && t < end.getTime();
    });
    buckets.push({
      at: start.toISOString(),
      label: `${String(start.getHours()).padStart(2, "0")}:00`,
      chakra: sum(rows),
      sales: rows.length,
    });
  }

  return {
    totalSold: sold.length,
    totalChakra: sum(sold),
    totalListed: listed.length,
    todayChakra: sum(today),
    todaySales: today.length,
    lastHourChakra: sum(lastHour),
    lastHourSales: lastHour.length,
    last24hChakra: sum(last24h),
    last24hSales: last24h.length,
    avgPerHour24: Math.round(sum(last24h) / 24),
    avgPerSale: sold.length ? Math.round(sum(sold) / sold.length) : 0,
    byRarity,
    buckets,
    recent: sold.slice(0, 40),
    lastAt: sold[0]?.at ?? null,
  };
}

export function tradeStats(trades) {
  const byRarity = {};
  for (const r of RARITY_ORDER) byRarity[r] = 0;
  let cards = 0;
  let alerts = [];
  for (const t of trades) {
    const n = t.count ?? 1;
    cards += n;
    byRarity[t.rarity] = (byRarity[t.rarity] || 0) + 1;
    if (isAlertRarity(t.rarity)) alerts.push({ name: t.name, rarity: t.rarity, at: t.at });
  }
  return {
    trades: trades.length,
    cards,
    byRarity,
    lastAt: trades[0]?.at ?? null,
    alerts: alerts.slice(0, 20),
  };
}

export function tradeBuckets(trades, sizeMs = 10 * 60 * 1000) {
  const map = new Map();
  for (const t of trades) {
    const ts = Date.parse(t.at) || Date.now();
    const key = Math.floor(ts / sizeMs) * sizeMs;
    let b = map.get(key);
    if (!b) {
      b = {
        at: new Date(key).toISOString(),
        label: hhmm(key),
        endLabel: hhmm(key + sizeMs - 1),
        trades: 0,
        cards: 0,
        byRarity: {},
        items: [],
      };
      map.set(key, b);
    }
    const n = t.count ?? 1;
    b.trades++;
    b.cards += n;
    b.byRarity[t.rarity] = (b.byRarity[t.rarity] || 0) + 1;
    if (b.items.length < 10) b.items.push({ name: t.name, rarity: t.rarity, image: t.image });
  }
  return [...map.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function hhmm(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildBatchReport(openings, extra = {}) {
  const cards = openings.flatMap((o) => o.cards || []);
  const byRarity = {};
  for (const r of RARITY_ORDER) byRarity[r] = 0;
  const seen = new Set();
  let newCards = 0;
  for (const c of cards) {
    byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
    if (c.isNew) {
      newCards++;
      seen.add(c.id);
    }
  }
  const sorted = [...cards].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || (b.pow || 0) - (a.pow || 0));
  return {
    ...extra,
    packId: openings[0]?.packId ?? null,
    packName: openings[0]?.packName ?? null,
    boosters: openings.length,
    cards,
    byRarity,
    newCards,
    newUnique: seen.size,
    goldens: openings.filter((o) => o.golden).length,
    godPacks: openings.filter((o) => o.godPack).length,
    top: sorted.slice(0, 12),
    alerts: cards.filter((c) => isAlertRarity(c.rarity)),
    startedAt: openings[0]?.at ?? new Date().toISOString(),
  };
}

export function rarityRank(r) {
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? -1 : i;
}

export function isAlertRarity(r) {
  return rarityRank(r) >= RARITY_ORDER.indexOf("L");
}

export function computeStats(history) {
  const byRarity = {};
  for (const r of RARITY_ORDER) byRarity[r] = 0;
  let cards = 0;
  let newCards = 0;
  let goldens = 0;
  let godPacks = 0;
  let alertCards = [];
  for (const e of history) {
    if (e.golden) goldens++;
    if (e.godPack) godPacks++;
    for (const c of e.cards || []) {
      cards++;
      byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
      if (c.isNew) newCards++;
      if (isAlertRarity(c.rarity)) {
        alertCards.push({ name: c.name, rarity: c.rarity, packId: e.packId, at: e.at });
      }
    }
  }
  return {
    openings: history.length,
    cards,
    newCards,
    goldens,
    godPacks,
    byRarity,
    best: alertCards.slice(0, 20),
  };
}

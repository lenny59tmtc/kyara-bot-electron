import { loadSales } from "./store.js";

const STRATEGIES = ["fast", "normal", "patient"];
const STRATEGY_LABELS = { fast: "Vite", normal: "Normal", patient: "Patient" };

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Analyse l'historique des ventes pour savoir quelle stratégie se vend le plus
 * vite. Les anciennes ventes peuvent ne pas avoir de listingId : on rapproche
 * alors l'annonce et la vente par personnage + prix.
 */
export function analyzeSellStrategies(sales = loadSales(5000)) {
  const listed = sales.filter((record) => record.kind === "listed" && record.strategy);
  const sold = sales.filter((record) => record.kind === "sold");
  const byListingId = new Map();
  for (const record of listed) if (record.listingId) byListingId.set(record.listingId, record);
  const used = new Set();
  const events = [];

  for (const record of sold) {
    let origin = record.listingId ? byListingId.get(record.listingId) : null;
    if (!origin) {
      const candidates = listed
        .filter((candidate) => {
          if (used.has(candidate.id)) return false;
          if (candidate.characterId !== record.characterId) return false;
          if (Number(candidate.price) !== Number(record.price)) return false;
          const at = new Date(candidate.at).getTime();
          const detected = new Date(record.detectedAt || record.at).getTime();
          return Number.isFinite(at) && Number.isFinite(detected) && at <= detected;
        })
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      origin = candidates[0] || null;
      if (origin) used.add(origin.id);
    }
    const strategy = origin?.strategy || (record.strategy !== "manual" ? record.strategy : null);
    if (!STRATEGIES.includes(strategy)) continue;
    const start = new Date(origin?.at || record.at).getTime();
    const end = new Date(record.detectedAt || record.at).getTime();
    const hours = (end - start) / 3600000;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 14) continue;
    events.push({
      strategy,
      hours,
      price: Number(record.price) || 0,
      name: record.name || null,
      soldAt: record.detectedAt || record.at,
    });
  }

  const strategies = STRATEGIES.map((strategy) => {
    const list = events.filter((event) => event.strategy === strategy);
    const values = list.map((event) => event.hours);
    return {
      strategy,
      label: STRATEGY_LABELS[strategy],
      count: list.length,
      medianHours: median(values),
      averageHours: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
      fastestHours: values.length ? Math.min(...values) : null,
    };
  });

  const eligible = strategies.filter((entry) => entry.count > 0);
  eligible.sort((a, b) => {
    const am = a.medianHours ?? Infinity;
    const bm = b.medianHours ?? Infinity;
    if (am !== bm) return am - bm;
    return a.averageHours - b.averageHours;
  });
  const recommended = eligible[0]?.strategy || "normal";
  return {
    at: new Date().toISOString(),
    events: events.length,
    strategies,
    recommended,
    recommendedLabel: STRATEGY_LABELS[recommended] || recommended,
    enoughData: events.length >= 3,
  };
}

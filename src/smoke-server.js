import { createServer } from "./server.js";
import { bus } from "./bus.js";

const PORT = Number(process.env.PORT) || 8799;

const bot = {
  config: { pack: "all", tradesAuto: true, soundOnRare: true },
  state: { pack: "all" },
  running: false,
  log: () => {},
  snapshot: () => ({ running: false, pseudo: "test", trade: { running: true, accepted: 1, filters: { missing: true, dupes: true }, candidates: 2 } }),
  trades: { snapshot: () => ({ running: true, accepted: 1, candidates: 2, filters: { missing: true, dupes: true }, lastCycleAt: new Date().toISOString(), lastError: null }) },
};

await createServer(bot);
const base = `http://127.0.0.1:${PORT}`;

const get = async (p) => {
  const r = await fetch(base + p);
  const t = await r.text();
  return { status: r.status, text: t };
};

const trades = await get("/api/trades?limit=50");
console.log("GET /api/trades →", trades.status, trades.text.slice(0, 600));

const state = await get("/api/state");
console.log("GET /api/state →", state.status, state.text.slice(0, 200));

const home = await get("/");
console.log("GET / →", home.status, "octets:", home.text.length, "| viewTrade:", home.text.includes('id="viewTrade"'), "| tradeSave:", home.text.includes('id="tradeSave"'));

const cfg = await get("/api/config");
console.log("GET /api/config →", cfg.status, cfg.text.slice(0, 300));

const got = [];
const sse = await fetch(base + "/events");
const reader = sse.body.getReader();
const decoder = new TextDecoder();
(async () => {
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const msg = JSON.parse(line.slice(6));
      got.push(msg.type);
      if (msg.type === "trade") {
        console.log("SSE trade reçu:", JSON.stringify(msg.trade));
        console.log("types SSE:", got.join(", "));
        process.exit(0);
      }
    }
  }
})();
setTimeout(() => {
  console.log("SSE types vus:", got.join(", ") || "aucun");
  process.exit(1);
}, 5000);
setTimeout(() => bus.emit("trade", { id: "fake", at: new Date().toISOString(), name: "Test", rarity: "U", gaveName: "Dup", from: "x" }), 500);

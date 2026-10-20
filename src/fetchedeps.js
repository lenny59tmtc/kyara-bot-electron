import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "recon", "app");
fs.mkdirSync(OUT, { recursive: true });

const BASE = "https://kyara.games/_app/immutable/";
const app = fs.readFileSync(path.join(process.env.TEMP || "", "opencode", "app.js"), "utf8");

const m = app.match(/m\.f\|\|\(m\.f=(\[[\s\S]*?\])\)\)/);
const files = JSON.parse(m[1].replace(/\.\.\//g, ""));

const nodeNum = process.argv[2] || "15";
const re = new RegExp("import\\(\\`\\.\\./nodes/" + nodeNum + "\\.[^\\`]+\\`\\),__vite__mapDeps\\((\\[[^\\]]*\\])");
const mm = app.match(re);
if (!mm) throw new Error("route introuvable " + nodeNum);
const idxs = JSON.parse(mm[1]);
const list = [...new Set(idxs)].map((i) => files[i]).filter(Boolean);
console.log(nodeNum, "→", list.length, "fichiers");

async function dl(f) {
  const url = BASE + f.replace(/^\.\//, "");
  const dest = path.join(OUT, path.basename(f));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  try {
    const r = await fetch(url);
    if (!r.ok) return console.log("KO", f, r.status);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    console.log("OK", f);
  } catch (e) {
    console.log("ERR", f, e.message);
  }
}
for (const f of list) await dl(f);
console.log("terminé");

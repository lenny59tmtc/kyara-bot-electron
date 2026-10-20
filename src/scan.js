import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "recon", "app");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".js"));
const pattern = process.argv[2] || "trades?";
const re = new RegExp(".{80}" + pattern + ".{80}", "gi");

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), "utf8");
  let m;
  let hits = 0;
  while ((m = re.exec(src)) && hits < 12) {
    console.log(`\n### ${f} @${m.index}\n${m[0]}`);
    hits++;
  }
}

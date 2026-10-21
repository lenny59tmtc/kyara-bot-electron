/**
 * Met à jour dist/latest.yml après signature de l'installateur.
 *
 * electron-builder génère latest.yml AVANT que l'on signe Kyara-Bot-Setup-*.exe.
 * electron-updater vérifie le sha512 de l'installateur téléchargé : ce script
 * recalcule donc le sha512 (base64) et la taille du Setup signé, puis réécrit
 * latest.yml. À lancer après scripts/sign-windows.ps1.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");
const ymlPath = path.join(distDir, "latest.yml");
if (!fs.existsSync(ymlPath)) {
  console.error("[latest.yml] fichier introuvable :", ymlPath);
  process.exit(1);
}

const yml = fs.readFileSync(ymlPath, "utf8");
const match = yml.match(/(?:url|path):\s*(Kyara-Bot-Setup-[^\s'"]+\.exe)/);
if (!match) {
  console.error("[latest.yml] aucun installateur Setup trouvé dans le manifeste :\n" + yml);
  process.exit(1);
}

const setupName = match[1];
const setupPath = path.join(distDir, setupName);
if (!fs.existsSync(setupPath)) {
  console.error("[latest.yml] installateur introuvable :", setupPath);
  process.exit(1);
}

const buffer = fs.readFileSync(setupPath);
const sha512 = crypto.createHash("sha512").update(buffer).digest("base64");
const size = buffer.length;
const releaseDate = new Date().toISOString();

let updated = yml
  .replace(/sha512:\s*\S+/g, `sha512: ${sha512}`)
  .replace(/size:\s*\d+/g, `size: ${size}`)
  .replace(/releaseDate:.*$/m, `releaseDate: '${releaseDate}'`);

fs.writeFileSync(ymlPath, updated);

console.log(`[latest.yml] ${setupName} — ${size} octets — sha512 ${sha512.slice(0, 16)}…`);
console.log(`[latest.yml] manifeste mis à jour (${ymlPath})`);

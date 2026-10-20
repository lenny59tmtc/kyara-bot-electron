/**
 * Configure Azure Trusted Signing pour electron-builder si les variables
 * d'environnement sont fournies (CI). Sans variables, ne fait rien.
 *
 * Variables attendues :
 *   AZURE_CODE_SIGNING_ENDPOINT   ex. https://wus2.codesigning.azure.net/
 *   AZURE_CODE_SIGNING_ACCOUNT    nom du compte Trusted Signing
 *   AZURE_CODE_SIGNING_PROFILE    nom du profil de certificat
 *
 * L'authentification Azure se fait via AZURE_TENANT_ID / AZURE_CLIENT_ID /
 * AZURE_CLIENT_SECRET (ou identité fédérée) lue par @electron/windows-sign.
 */
import fs from "node:fs";

const endpoint = process.env.AZURE_CODE_SIGNING_ENDPOINT?.trim();
const accountName = process.env.AZURE_CODE_SIGNING_ACCOUNT?.trim();
const profileName = process.env.AZURE_CODE_SIGNING_PROFILE?.trim();

if (!endpoint || !accountName || !profileName) {
  console.log("[azure-signing] variables absentes : signature Azure non configurée.");
  process.exit(0);
}

const packagePath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.build = pkg.build || {};
pkg.build.win = pkg.build.win || {};
pkg.build.win.azureSignOptions = {
  endpoint,
  codeSigningAccountName: accountName,
  certificateProfileName: profileName,
};
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
console.log("[azure-signing] azureSignOptions configuré pour electron-builder.");

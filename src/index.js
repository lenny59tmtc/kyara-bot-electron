import { KyaraBot } from "./bot.js";
import { createServer } from "./server.js";
import { getCurrentVersion, startUpdateChecker } from "./update.js";

const bot = new KyaraBot();
bot.state.version = getCurrentVersion();
await createServer(bot);
startUpdateChecker();

// Le serveur HTTP répond immédiatement (readiness de l'application Electron).
// Le bot démarre ensuite : si Chromium met du temps à se lancer, l'interface
// reste joignable et affiche l'état au lieu de bloquer le démarrage de l'app.
setTimeout(() => {
  bot.start().catch((error) => {
    console.error("[bot] démarrage impossible :", error?.stack || error);
  });
}, 1200);

async function shutdown() {
  console.log("\nArrêt…");
  await bot.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

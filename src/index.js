import { KyaraBot } from "./bot.js";
import { createServer } from "./server.js";
import { getCurrentVersion, startUpdateChecker } from "./update.js";

const bot = new KyaraBot();
bot.state.version = getCurrentVersion();
await createServer(bot);
startUpdateChecker();

async function shutdown() {
  console.log("\nArrêt…");
  await bot.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await bot.start();

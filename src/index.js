import { KyaraBot } from "./bot.js";
import { createServer } from "./server.js";

const bot = new KyaraBot();
await createServer(bot);
await bot.start();

async function shutdown() {
  console.log("\nArrêt…");
  await bot.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

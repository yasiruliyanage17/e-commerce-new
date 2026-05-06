import cron from "node-cron";
import { sendProductsToAI } from "../services/aiService.js";

if (!process.env.AI_SERVICE_URL) {
  console.log("ℹ️  AI_SERVICE_URL not configured — daily AI sync cron will not run");
} else {
  // Every day at 2 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("⏰ Daily AI cron started");
    await sendProductsToAI();
  });
}

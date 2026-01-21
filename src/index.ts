import dotenv from "dotenv";

// Load environment variables FIRST before importing anything else
dotenv.config();

import mongoose from "mongoose";
import bot from "./bot/telegramBot";

// Connect to MongoDB
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/barber";

mongoose
  .connect(mongoUri)
  .then(async () => {
    console.log("✅ Connected to MongoDB");

    // Start the bot after MongoDB connection
    await bot.start();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down bot...");
  bot.stop();
  await mongoose.connection.close();
  process.exit(0);
});

console.log("🤖 Telegram Bot Server started");

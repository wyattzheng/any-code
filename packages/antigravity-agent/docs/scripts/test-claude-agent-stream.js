import fs from "fs";
import os from "os";
import path from "path";
import { ClaudeCodeAgent } from "./src/chat-agent.ts";

function loadCurrentAccount() {
  try {
    const settingsPath = path.join(os.homedir(), ".anycode", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const accounts = Array.isArray(settings.accounts) ? settings.accounts : [];
    const currentAccount = accounts.find((account) => account.id === settings.currentAccountId) || accounts[0] || null;
    return {
      model: currentAccount?.MODEL || "qwen3-max-2026-01-23",
      apiKey: currentAccount?.API_KEY || "",
      baseUrl: currentAccount?.BASE_URL || "",
    };
  } catch {
    return {
      model: "qwen3-max-2026-01-23",
      apiKey: "",
      baseUrl: "",
    };
  }
}

async function main() {
  const config = loadCurrentAccount();
  const agent = new ClaudeCodeAgent({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  const ctx = {
    // dummy context
    fs: process.cwd(),
  };

  const messages = "你好，请回复'收到'。请思考一下再说。";

  console.log("Starting chat stream...");
  try {
    const stream = agent.chat(messages);

    for await (const msg of stream) {
      if (msg.type === "thinking.delta") {
        process.stdout.write(`\x1b[90m${msg.thinkingContent}\x1b[0m`);
      } else if (msg.type === "text.delta") {
        process.stdout.write(msg.content);
      } else if (msg.type === "done") {
        console.log("\n\n[Done]");
      } else if (msg.type === "error") {
        console.error("\n[Error]", msg.error);
      } else {
        console.log(`\n[Other Event]:`, msg);
      }
    }
  } catch (error) {
    console.error("Stream failed:", error);
  }
}

main().catch(console.error);

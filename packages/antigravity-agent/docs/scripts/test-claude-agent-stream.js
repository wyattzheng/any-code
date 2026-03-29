import { ClaudeCodeAgent } from "./src/chat-agent.ts";

async function main() {
  const agent = new ClaudeCodeAgent({
    model: process.env.MODEL || "qwen3-max-2026-01-23",
    apiKey: process.env.API_KEY || "",
    baseUrl: process.env.BASE_URL || "",
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

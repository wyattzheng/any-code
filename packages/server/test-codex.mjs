import { Codex } from "@openai/codex-sdk";

// Test to dump ALL event shapes
console.log("=== Codex Event Dump Test ===\n");

const codex = new Codex({});
const thread = codex.startThread({
  model: "gpt-5.4",
  skipGitRepoCheck: true,
  approvalPolicy: "never",
  sandboxMode: "danger-full-access",
});

const { events } = await thread.runStreamed("say hello", {});

const timeout = setTimeout(() => {
  console.log("\n⏰ Timeout after 30s");
  process.exit(1);
}, 30000);

for await (const event of events) {
  // Dump every event with full detail
  const eventStr = JSON.stringify(event, null, 2);
  console.log(`\n=== EVENT: ${event.type} ===`);
  console.log(eventStr.substring(0, 1000));
}

clearTimeout(timeout);
console.log("\n✅ All events consumed");
process.exit(0);

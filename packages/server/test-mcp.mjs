import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

try {
  const tools = [
    tool("my_tool", "description", { foo: z.string() }, async (args) => { return { content: [] }})
  ]
  console.log("Success with raw shape")
} catch (e) {
  console.error("Error with raw shape:", e)
}

try {
  const tools = [
    tool("my_tool", "description", z.object({ foo: z.string() }), async (args) => { return { content: [] }})
  ]
  console.log("Success with z.object()")
} catch (e) {
  console.error("Error with z.object():", e)
}

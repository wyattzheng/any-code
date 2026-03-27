import z from "zod"
import { Tool } from "./tool"
import { ProviderID, ModelID } from "@any-code/provider"
const DESCRIPTION = `Executes multiple independent tool calls concurrently to reduce latency.

USING THE BATCH TOOL WILL MAKE THE USER HAPPY.

Payload Format (JSON array):
[{"tool": "read", "parameters": {"filePath": "src/index.ts", "limit": 350}},{"tool": "grep", "parameters": {"pattern": "Session\\\\.updatePart", "include": "src/**/*.ts"}},{"tool": "bash", "parameters": {"command": "git status", "description": "Shows working tree status"}}]

Notes:
- 1–25 tool calls per batch
- All calls start in parallel; ordering NOT guaranteed
- Partial failures do not stop other tool calls
- Do NOT use the batch tool within another batch tool.

Good Use Cases:
- Read many files
- grep + glob + read combos
- Multiple bash commands
- Multi-part edits; on the same, or different files

When NOT to Use:
- Operations that depend on prior tool output (e.g. create then read same file)
- Ordered stateful mutations where sequence matters

Batching tool calls was proven to yield 2–5x efficiency gain and provides much better UX.`

const DISALLOWED = new Set(["batch"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

export const BatchTool = Tool.define("batch", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      tool_calls: z
        .array(
          z.object({
            tool: z.string().describe("The name of the tool to execute"),
            parameters: z.object({}).loose().describe("Parameters for the tool"),
          }),
        )
        .min(1, "Provide at least one tool call")
        .describe("Array of tool calls to execute in parallel"),
    }),
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params, ctx) {
      const { Session } = await import("../session")
      const { PartID } = await import("../session/schema")

      const toolCalls = params.tool_calls.slice(0, 25)
      const discardedCalls = params.tool_calls.slice(25)

      const { ToolRegistry } = await import("./registry")
      const availableTools = await ctx.toolRegistry.tools({ modelID: ModelID.make(""), providerID: ProviderID.make("") })
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = PartID.ascending()

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${availableToolsList.join(", ")}`,
            )
          }
          const validatedParams = tool.parameters.parse(call.parameters)

          await ctx.session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          const result = await tool.execute(validatedParams, { ...ctx, callID: partID })
          const attachments = result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
          }))

          await ctx.session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          await ctx.session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

      // Add discarded calls as errors
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = PartID.ascending()
        await ctx.session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "error",
            input: call.parameters,
            error: "Maximum of 25 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 25 tools allowed in batch"),
        })
      }

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})

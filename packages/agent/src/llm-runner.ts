import type { AgentContext } from "./context"
import { Provider, VendorRegistry, createLLMStream } from "@any-code/provider"
import { Auth } from "./util/auth"
import { MessageV2 } from "./memory/message-v2"
import { SessionService } from "./session"
import { PartID, SessionID } from "./session/schema"
import { SessionStatus } from "./session"
import type { LLMStreamChunk, LLMStreamResult, LLMStreamInput, LLMToolDef, LLMMessage } from "@any-code/utils"

export type { LLMStreamChunk, LLMStreamResult, LLMStreamInput, LLMToolDef, LLMMessage } from "@any-code/utils"

/** Agent-level stream input — extends the canonical LLMStreamInput with agent-specific fields */
export type AgentStreamInput = Omit<LLMStreamInput, 'model'> & {
  user: MessageV2.User
  model: Provider.Model
  /** Optional system prompt override (e.g. for compaction) */
  prompt?: string
}

export const LLM_OUTPUT_TOKEN_MAX = VendorRegistry.getModelProvider().getOutputTokenMax()

export async function llmStream(context: AgentContext, input: AgentStreamInput): Promise<LLMStreamResult> {
  const l = context.log.create({ service: "llm" })
    .clone()
    .tag("providerID", input.model.providerID)
    .tag("modelID", input.model.id)
    .tag("sessionID", input.sessionID)
    .tag("small", (input.small ?? false).toString())
  l.info("stream", {
    modelID: input.model.id,
    providerID: input.model.providerID,
  })

  const modelProvider = VendorRegistry.getModelProvider({ model: input.model })
  const includeProviderPrompt = modelProvider.shouldIncludeProviderSystemPrompt()

  // Agent-level: construct system prompts
  const system: string[] = []
  system.push(
    [
      ...(input.prompt ? [input.prompt] : includeProviderPrompt ? context.systemPrompt.provider(input.model) : []),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  )

  const header = system[0]
  if (system.length > 2 && system[0] === header) {
    const rest = system.slice(1)
    system.length = 0
    system.push(header, rest.join("\n"))
  }

  // Agent-level: resolve and filter tools
  const tools = await resolveTools(input)
  const isLiteLLMProxy = modelProvider.shouldAddNoopToolFallback()

  if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
    tools["_noop"] = {
      description: "Placeholder for LiteLLM/Anthropic proxy compatibility",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ output: "", title: "", metadata: {} }),
    }
  }

  // Delegate to provider for AI SDK call
  return createLLMStream(
    {
      provider: context.provider,
      auth: { get: Auth.get },
      config: context.config,
      systemPrompt: context.systemPrompt,
      log: { info: l.info.bind(l), error: l.error.bind(l) },
    },
    {
      model: input.model,
      sessionID: input.sessionID,
      system,
      messages: input.messages,
      tools,
      toolChoice: input.toolChoice,
      abort: input.abort,
      small: input.small,
      retries: input.retries,
    },
  )
}

async function resolveTools(input: Pick<AgentStreamInput, "tools" | "user">): Promise<Record<string, LLMToolDef>> {
  for (const name of Object.keys(input.tools)) {
    if (input.user.tools?.[name] === false) {
      delete input.tools[name]
    }
  }
  return input.tools
}

export function hasToolCalls(messages: LLMMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

const DOOM_LOOP_THRESHOLD = 3

export type LLMRunnerInfo = Awaited<ReturnType<typeof createLLMRunner>>
export type LLMRunnerResult = Awaited<ReturnType<LLMRunnerInfo["process"]>>

export function createLLMRunner(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
  abort: AbortSignal
  context: AgentContext
  onStatusChange?: (sessionID: SessionID, status: SessionStatus.Info) => void
  onError?: (sessionID: SessionID, error: any) => void
}) {
  const toolcalls: Record<string, MessageV2.ToolPart> = {}
  let blocked = false
  let attempt = 0
  let needsCompaction = false

  const result = {
    get message() {
      return input.assistantMessage
    },
    partFromToolCall(toolCallID: string) {
      return toolcalls[toolCallID]
    },
    async process(streamInput: AgentStreamInput) {
      input.context.log.create({ service: "session.processor" }).info("process")
      needsCompaction = false
      const shouldBreak = (input.context.config).experimental?.continue_loop_on_deny !== true
      while (true) {
        try {
          let currentText: MessageV2.TextPart | undefined
          let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
          const stream = await llmStream(input.context, streamInput)

          for await (const value of stream.fullStream) {
            input.abort.throwIfAborted()
            switch (value.type) {
              case "start":
                input.onStatusChange?.(input.sessionID, { type: "busy" })
                break

              case "reasoning-start":
                if (value.id in reasoningMap) {
                  continue
                }
                const reasoningPart = {
                  id: PartID.ascending(),
                  messageID: input.assistantMessage.id,
                  sessionID: input.assistantMessage.sessionID,
                  type: "reasoning" as const,
                  text: "",
                  time: {
                    start: Date.now(),
                  },
                  metadata: value.providerMetadata,
                }
                reasoningMap[value.id] = reasoningPart
                await input.context.session.updatePart(reasoningPart)
                break

              case "reasoning-delta":
                if (value.id in reasoningMap) {
                  const part = reasoningMap[value.id]
                  part.text += value.text
                  if (value.providerMetadata) part.metadata = value.providerMetadata
                  await input.context.session.updatePartDelta({
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    field: "text",
                    delta: value.text,
                  })
                }
                break

              case "reasoning-end":
                if (value.id in reasoningMap) {
                  const part = reasoningMap[value.id]
                  part.text = part.text.trimEnd()

                  part.time = {
                    ...part.time,
                    end: Date.now(),
                  }
                  if (value.providerMetadata) part.metadata = value.providerMetadata
                  await input.context.session.updatePart(part)
                  delete reasoningMap[value.id]
                }
                break

              case "tool-input-start":
                const part = await input.context.session.updatePart({
                  id: toolcalls[value.id]?.id ?? PartID.ascending(),
                  messageID: input.assistantMessage.id,
                  sessionID: input.assistantMessage.sessionID,
                  type: "tool",
                  tool: value.toolName,
                  callID: value.id,
                  state: {
                    status: "pending",
                    input: {},
                    raw: "",
                  },
                })
                toolcalls[value.id] = part as MessageV2.ToolPart
                break

              case "tool-input-delta":
                break

              case "tool-input-end":
                break

              case "tool-call": {
                const match = toolcalls[value.toolCallId]
                if (match) {
                  const part = await input.context.session.updatePart({
                    ...match,
                    tool: value.toolName,
                    state: {
                      status: "running",
                      input: value.input,
                      time: {
                        start: Date.now(),
                      },
                    },
                    metadata: value.providerMetadata,
                  })
                  toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                  const parts = await MessageV2.parts(input.context, input.assistantMessage.id)
                  const lastThree = (parts as any[]).slice(-DOOM_LOOP_THRESHOLD)

                  if (
                    lastThree.length === DOOM_LOOP_THRESHOLD &&
                    lastThree.every(
                      (p) =>
                        p.type === "tool" &&
                        p.tool === value.toolName &&
                        p.state.status !== "pending" &&
                        JSON.stringify(p.state.input) === JSON.stringify(value.input),
                    )
                  ) {
                    // Doom loop detected — previously asked for permission, now always-allowed
                  }
                }
                break
              }
              case "tool-result": {
                const match = toolcalls[value.toolCallId]
                if (match && match.state.status === "running") {
                  await input.context.session.updatePart({
                    ...match,
                    state: {
                      status: "completed",
                      input: value.input ?? match.state.input,
                      output: input.context.compaction.truncateToolOutput((value.output as any).output),
                      metadata: (value.output as any).metadata,
                      title: (value.output as any).title,
                      time: {
                        start: match.state.time.start,
                        end: Date.now(),
                      },
                      attachments: (value.output as any).attachments,
                    },
                  })

                  delete toolcalls[value.toolCallId]
                }
                break
              }

              case "tool-error": {
                const match = toolcalls[value.toolCallId]
                if (match && match.state.status === "running") {
                  await input.context.session.updatePart({
                    ...match,
                    state: {
                      status: "error",
                      input: value.input ?? match.state.input,
                      error: (value.error as any).toString(),
                      time: {
                        start: match.state.time.start,
                        end: Date.now(),
                      },
                    },
                  })

                  delete toolcalls[value.toolCallId]
                }
                break
              }
              case "error":
                throw value.error

              case "start-step":
                await input.context.session.updatePart({
                  id: PartID.ascending(),
                  messageID: input.assistantMessage.id,
                  sessionID: input.sessionID,
                  type: "step-start",
                })
                break

              case "finish-step":
                const usage = SessionService.getUsage({
                  model: input.model,
                  usage: value.usage as any,
                  metadata: value.providerMetadata,
                })
                input.assistantMessage.finish = value.finishReason
                await input.context.session.updatePart({
                  id: PartID.ascending(),
                  reason: value.finishReason,
                  messageID: input.assistantMessage.id,
                  sessionID: input.assistantMessage.sessionID,
                  type: "step-finish",
                  tokens: usage.tokens,
                  cost: usage.cost,
                })
                await input.context.session.updateMessage(input.assistantMessage)

                if (
                  !input.assistantMessage.summary &&
                  (await input.context.compaction.isOverflow({ tokens: usage.tokens, model: input.model, context: input.context }))
                ) {
                  needsCompaction = true
                }
                break

              case "text-start":
                currentText = {
                  id: PartID.ascending(),
                  messageID: input.assistantMessage.id,
                  sessionID: input.assistantMessage.sessionID,
                  type: "text",
                  text: "",
                  time: {
                    start: Date.now(),
                  },
                  metadata: value.providerMetadata,
                }
                await input.context.session.updatePart(currentText)
                break

              case "text-delta":
                if (currentText) {
                  currentText.text += value.text
                  if (value.providerMetadata) currentText.metadata = value.providerMetadata
                  await input.context.session.updatePartDelta({
                    sessionID: currentText.sessionID,
                    messageID: currentText.messageID,
                    partID: currentText.id,
                    field: "text",
                    delta: value.text,
                  })
                }
                break

              case "text-end":
                if (currentText) {
                  currentText.text = currentText.text.trimEnd()
                  const textOutput = { text: currentText.text }
                  currentText.text = textOutput.text
                  currentText.time = {
                    start: Date.now(),
                    end: Date.now(),
                  }
                  if (value.providerMetadata) currentText.metadata = value.providerMetadata
                  await input.context.session.updatePart(currentText)
                }
                currentText = undefined
                break

              case "finish":
                break

              default:
                input.context.log.create({ service: "session.processor" }).info("unhandled stream chunk", {
                  type: (value as any).type,
                })
                continue
            }
            if (needsCompaction) break
          }
        } catch (e: any) {
          input.context.log.create({ service: "session.processor" }).error("process", {
            error: e,
            stack: JSON.stringify(e.stack),
          })
          const error = MessageV2.fromError(e, { providerID: input.model.providerID })
          if (MessageV2.ContextOverflowError.isInstance(error)) {
            needsCompaction = true
            input.onError?.(input.sessionID, error)
          } else {
            input.assistantMessage.error = error
            input.onError?.(input.assistantMessage.sessionID, input.assistantMessage.error)
          }
        }

        const p = await MessageV2.parts(input.context, input.assistantMessage.id)
        for (const part of p) {
          if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
            await input.context.session.updatePart({
              ...part,
              state: {
                ...part.state,
                status: "error",
                error: "Tool execution aborted",
                time: {
                  start: Date.now(),
                  end: Date.now(),
                },
              },
            })
          }
        }
        input.assistantMessage.time.completed = Date.now()
        await input.context.session.updateMessage(input.assistantMessage)

        input.onStatusChange?.(input.sessionID, { type: "idle" })

        if (needsCompaction) return "compact"
        if (blocked) return "stop"
        if (input.assistantMessage.error) return "stop"
        return "continue"
      }
    },
  }
  return result
}

// Backward-compat aliases for callers still using namespace-style
export namespace LLMRunner {
  export type Info = LLMRunnerInfo
  export type Result = LLMRunnerResult
  export const create = createLLMRunner
}

export namespace LLM {
  export const OUTPUT_TOKEN_MAX = LLM_OUTPUT_TOKEN_MAX
  export type StreamInput = LLMStreamInput
  export type StreamOutput = LLMStreamResult
  export const stream = llmStream
  export const checkToolCalls = hasToolCalls
}

// Re-export helpers from provider (so existing callers don't break)
export { convertUIToModelMessages, isAPICallError, isLoadAPIKeyError } from "@any-code/provider"

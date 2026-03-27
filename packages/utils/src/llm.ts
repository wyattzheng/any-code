/**
 * LLM abstraction types — shared between agent and provider.
 *
 * These types define the interface contract for LLM streaming,
 * decoupling agent from any specific AI SDK.
 */

// ── Stream chunk types ──────────────────────────────────────────────────────

export type LLMStreamChunk =
  | { type: "start" }
  | { type: "text-start"; providerMetadata?: Record<string, any> }
  | { type: "text-delta"; text: string; providerMetadata?: Record<string, any> }
  | { type: "text-end"; providerMetadata?: Record<string, any> }
  | { type: "reasoning-start"; id: string; providerMetadata?: Record<string, any> }
  | { type: "reasoning-delta"; id: string; text: string; providerMetadata?: Record<string, any> }
  | { type: "reasoning-end"; id: string; providerMetadata?: Record<string, any> }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: any; providerMetadata?: Record<string, any> }
  | { type: "tool-result"; toolCallId: string; input?: any; output: any }
  | { type: "tool-error"; toolCallId: string; input?: any; error: any }
  | { type: "start-step" }
  | { type: "finish-step"; usage: LLMUsage; finishReason: string; providerMetadata?: Record<string, any> }
  | { type: "finish" }
  | { type: "error"; error: any }

export interface LLMUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

// ── Stream result ────────────────────────────────────────────────────────────

export interface LLMStreamResult {
  fullStream: AsyncIterable<LLMStreamChunk>
}

// ── Message & tool types ─────────────────────────────────────────────────────

export type LLMMessage = { role: string; content: any }

export interface LLMToolDef {
  id?: string
  description: string
  parameters: Record<string, any>
  execute: (input: any, options: LLMToolCallOptions) => Promise<any>
}

export interface LLMToolCallOptions {
  toolCallId: string
  abortSignal?: AbortSignal
}

// ── Stream input (provider-level) ────────────────────────────────────────────

/** Input for the provider-level LLM stream adapter */
export interface LLMProviderStreamInput {
  model: { id: string; providerID: string; [key: string]: any }
  sessionID: string
  system: string[]
  messages: LLMMessage[]
  tools: Record<string, LLMToolDef>
  toolChoice?: "auto" | "required" | "none"
  abort: AbortSignal
  small?: boolean
  retries?: number
}

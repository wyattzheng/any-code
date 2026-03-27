/**
 * LLM abstraction layer — agent-specific types that reference AgentContext.
 *
 * Generic LLM types (LLMStreamChunk, LLMToolDef, etc.) live in @any-code/utils.
 * This file defines agent-specific input types that reference agent internals.
 */

export type {
  LLMStreamChunk,
  LLMStreamResult,
  LLMToolDef,
  LLMToolCallOptions,
  LLMMessage,
  LLMUsage,
} from "@any-code/utils"

import type { Provider } from "@any-code/provider"
import type { AgentContext } from "./context"
import type { MessageV2 } from "./memory/message-v2"
import type { LLMToolDef, LLMMessage } from "@any-code/utils"

// ── Agent-specific stream input ──────────────────────────────────────────────

export interface LLMStreamInput {
  user: MessageV2.User
  sessionID: string
  model: Provider.Model
  /** Optional system prompt override (e.g. for compaction) */
  prompt?: string
  system: string[]
  abort: AbortSignal
  messages: LLMMessage[]
  small?: boolean
  tools: Record<string, LLMToolDef>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  context: AgentContext
}

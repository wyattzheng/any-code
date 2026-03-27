/**
 * LLM abstraction layer — re-exports from @any-code/utils.
 *
 * All canonical LLM types live in @any-code/utils.
 * This file provides convenient re-exports for agent modules.
 */

export type {
  LLMStreamChunk,
  LLMStreamResult,
  LLMStreamInput,
  LLMToolDef,
  LLMToolCallOptions,
  LLMMessage,
  LLMUsage,
} from "@any-code/utils"

import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ModelMessage } from "ai"
import PROMPT_BEAST from "../../prompt/prompt/beast.txt"
import PROMPT_CODEX from "../../prompt/prompt/codex_header.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "../../prompt/prompt/qwen.txt"
import PROMPT_TRINITY from "../../prompt/prompt/trinity.txt"
import type { VendorProvider } from "./types"

export const openAIVendor: VendorProvider = {
  id: "openai",
  npms: ["@ai-sdk/openai", "@ai-sdk/openai-compatible"],
  bundled: {
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
  },
  sdkKeys: {
    "@ai-sdk/openai": "openai",
    "@ai-sdk/openai-compatible": "openaiCompatible",
  },
  async customLoader() {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        // sdk.responses() is only available on @ai-sdk/openai, not on
        // @ai-sdk/openai-compatible. Fall back to languageModel() when
        // the Responses API helper is missing (e.g. third-party endpoints).
        if (typeof sdk.responses === "function") {
          return sdk.responses(modelID)
        }
        return sdk.languageModel(modelID)
      },
      options: {},
    }
  },
  patchRequest({ opts, model }) {
    if (opts.body && opts.method === "POST") {
      try {
        const body = JSON.parse(opts.body as string)
        const isAzure = model.providerID?.includes("azure")
        const keepIds = isAzure && body.store === true
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) delete item.id
          }
          opts.body = JSON.stringify(body)
        }
      } catch {
        // Ignore parse errors
      }
    }
  },
  transform: {
    message(msgs, model) {
      if (!(model.api.npm === "@ai-sdk/openai-compatible" && typeof model.capabilities.interleaved === "object" && model.capabilities.interleaved.field)) {
        return msgs
      }

      const field = model.capabilities.interleaved.field
      return msgs.map((msg) => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
          const reasoningText = reasoningParts.map((part: any) => part.text).join("")
          const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

          if (reasoningText) {
            return {
              ...msg,
              content: filteredContent,
              providerOptions: {
                ...msg.providerOptions,
                openaiCompatible: {
                  ...(msg.providerOptions as any)?.openaiCompatible,
                  [field]: reasoningText,
                },
              },
            }
          }

          return { ...msg, content: filteredContent }
        }
        return msg
      }) as ModelMessage[]
    },
    options({ model, sessionID, providerOptions }) {
      const result: Record<string, any> = {}

      if (model.providerID === "openai" || model.api.npm === "@ai-sdk/openai") {
        result["store"] = false
      }

      if (model.providerID === "openai" || providerOptions?.setCacheKey) {
        result["promptCacheKey"] = sessionID
      }

      if (model.api.id.includes("gpt-5") && !model.api.id.includes("gpt-5-chat")) {
        if (!model.api.id.includes("gpt-5-pro")) {
          result["reasoningEffort"] = "high"
          result["reasoningSummary"] = "auto"
        }
        if (model.api.id.includes("gpt-5.") && !model.api.id.includes("codex") && !model.api.id.includes("-chat")) {
          result["textVerbosity"] = "low"
        }
      }

      return result
    },
    smallOptions(model) {
      if (!(model.providerID === "openai" || model.api.npm === "@ai-sdk/openai")) return {}
      if (model.api.id.includes("gpt-5")) {
        if (model.api.id.includes("5.")) return { store: false, reasoningEffort: "low" }
        return { store: false, reasoningEffort: "minimal" }
      }
      return { store: false }
    },
  },
  llm: {
    useInstructionPrompt({ provider, auth }) {
      return provider.id === "openai" && auth?.type === "oauth"
    },
    includeProviderSystemPrompt({ provider, auth }) {
      return !(provider.id === "openai" && auth?.type === "oauth")
    },
    disableMaxOutputTokens({ provider, auth }) {
      return provider.id === "openai" && auth?.type === "oauth"
    },
  },
  prompt: {
    provider(model) {
      if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
      if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
      if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3")) {
        return [PROMPT_BEAST]
      }
      if (model.api.id.includes("gemini-") || model.api.id.includes("claude")) return undefined
      if (model.api.npm === "@ai-sdk/openai-compatible") return [PROMPT_ANTHROPIC_WITHOUT_TODO]
      return undefined
    },
    instructions(model) {
      if (!model.api.id.includes("gpt-5")) return undefined
      return PROMPT_CODEX.trim()
    },
  },
}

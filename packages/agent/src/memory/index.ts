import type { AgentContext } from "../context"
import { Bus } from "../bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata } from "ai"


import { MessageV2 } from "./message-v2"
import type { Provider } from "../provider/provider"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"

import { fn } from "../util/fn"
import { iife } from "../util/fn"
import { NotFoundError } from "../storage"

/**
 * MemoryService — manages message & part persistence + real-time event emission.
 *
 * Each CodeAgent instance gets its own MemoryService via AgentContext.
 * All write operations emit bus events immediately (required for streaming).
 */
export class MemoryService {
  constructor(private context: AgentContext) {}

  async updateMessage(msg: any) {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    this.context.db.upsert("message",
      { id, session_id: sessionID, time_created, data },
      ["id"],
      { data },
    )
    Bus.publish(this.context, MessageV2.Event.Updated, {
      info: msg,
    })
    return msg
  }

  async removeMessage(input: any) {
    // CASCADE delete handles parts automatically
    this.context.db.remove("message",
      { op: "and", conditions: [{ op: "eq", field: "id", value: input.messageID }, { op: "eq", field: "session_id", value: input.sessionID }] },
    )
    Bus.publish(this.context, MessageV2.Event.Removed, {
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
  }

  async removePart(input: any) {
    this.context.db.remove("part",
      { op: "and", conditions: [{ op: "eq", field: "id", value: input.partID }, { op: "eq", field: "session_id", value: input.sessionID }] },
    )
    Bus.publish(this.context, MessageV2.Event.PartRemoved, {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
    })
  }

  async updatePart(part: any) {
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    this.context.db.upsert("part",
      { id, message_id: messageID, session_id: sessionID, time_created: time, data },
      ["id"],
      { data },
    )
    Bus.publish(this.context, MessageV2.Event.PartUpdated, {
      part: structuredClone(part),
    })
    return part
  }

  async updatePartDelta(input: any) {
    Bus.publish(this.context, MessageV2.Event.PartDelta, input)
  }

  async messages(input: { sessionID: any; limit?: number }) {
    const result = [] as MessageV2.WithParts[]
    for await (const msg of MessageV2.stream(this.context, input.sessionID)) {
      if (input.limit && result.length >= input.limit) break
      result.push(msg)
    }
    result.reverse()
    return result
  }
}

/**
 * Static utility functions (no context dependency).
 */
export namespace Memory {
  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like OpenCode's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )
}

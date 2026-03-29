# Antigravity Model Configuration

> Last updated: 2026-03-29
> Source: Cloud Code API (`daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`)

## How Model Selection Works

1. **Cloud Code API** returns model list with string IDs (e.g. `claude-opus-4-6-thinking`) and a `model` field containing the **proto enum name** (e.g. `MODEL_PLACEHOLDER_M26`)
2. The proto enum name maps to a **numeric `planModel` value** used in `CascadePlannerConfig`
3. Placeholder models use the pattern `MODEL_PLACEHOLDER_M{N}` → `planModel = 1000 + N`
4. Named models (e.g. `MODEL_GOOGLE_GEMINI_2_5_PRO`) have fixed numeric IDs defined in the proto

## Available Models

### Claude (Anthropic)

| Display Name | Cloud ID | Proto Enum | `planModel` | Provider | Thinking | Max Output |
|---|---|---|---|---|---|---|
| **Claude Opus 4.6 (Thinking)** | `claude-opus-4-6-thinking` | `MODEL_PLACEHOLDER_M26` | **1026** | Anthropic Vertex | ✅ | 64K |
| Claude Sonnet 4.6 (Thinking) | `claude-sonnet-4-6` | `MODEL_PLACEHOLDER_M35` | 1035 | Anthropic Vertex | ✅ | 64K |

### Gemini (Google)

| Display Name | Cloud ID | Proto Enum | `planModel` | Provider | Thinking | Max Output |
|---|---|---|---|---|---|---|
| **Gemini 3.1 Pro (High)** | `gemini-3.1-pro-high` | `MODEL_PLACEHOLDER_M37` | **1037** | Google Gemini | ✅ | 65K |
| Gemini 3.1 Pro (Low) | `gemini-3.1-pro-low` | `MODEL_PLACEHOLDER_M36` | 1036 | Google Gemini | ✅ | 65K |
| Gemini 3.1 Flash Lite | `gemini-3.1-flash-lite` | `MODEL_PLACEHOLDER_M50` | 1050 | Google Gemini | ❌ | 65K |
| Gemini 3.1 Flash Image | `gemini-3.1-flash-image` | `MODEL_PLACEHOLDER_M21` | 1021 | Google Gemini | ❌ | — |
| **Gemini 2.5 Pro** | `gemini-2.5-pro` | `MODEL_GOOGLE_GEMINI_2_5_PRO` | **246** | Google Gemini | ✅ | 65K |
| Gemini 3 Pro (High) | `gemini-3-pro-high` | (check API) | — | Google Gemini | ✅ | — |
| Gemini 3 Pro (Low) | `gemini-3-pro-low` | (check API) | — | Google Gemini | ✅ | — |
| Gemini 3 Flash | `gemini-3-flash` | (check API) | — | Google Gemini | ✅ | — |

### OpenAI

| Display Name | Cloud ID | Proto Enum | `planModel` | Provider | Thinking | Max Output |
|---|---|---|---|---|---|---|
| GPT-OSS 120B (Medium) | `gpt-oss-120b-medium` | `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` | (check) | OpenAI Vertex | ✅ | 32K |

## Current Configuration

```typescript
planModel: 1026  // MODEL_PLACEHOLDER_M26 = Claude Opus 4.6 (Thinking)
```

## Deprecated Models

| Old Model | Error Message |
|---|---|
| `MODEL_PLACEHOLDER_M8` (1008) | "Gemini 3 Pro is no longer available" |
| `MODEL_CLAUDE_4_OPUS_THINKING` (291) | "unknown model key: model not found" |

> **Note**: Numeric IDs like 291 (`MODEL_CLAUDE_4_OPUS_THINKING`) are **legacy proto enum values** that are no longer valid. The Cloud backend now uses **dynamic placeholder IDs** (`MODEL_PLACEHOLDER_M{N}`) that can be remapped server-side without binary updates.

## API Discovery

To fetch the current model list:

```bash
node .dev/get-models.mjs
```

This calls the Cloud Code API to get real-time model availability, quota, and ID mappings.

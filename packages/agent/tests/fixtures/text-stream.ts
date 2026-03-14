/**
 * SSE fixture: Text-only streaming response
 * OpenAI Chat Completions API format (/v1/chat/completions)
 */

export const TEXT_STREAM_CHUNKS = [
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n`,
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"! How"},"finish_reason":null}]}\n\n`,
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" can I"},"finish_reason":null}]}\n\n`,
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" help you?"},"finish_reason":null}]}\n\n`,
    `data: {"id":"chatcmpl-test123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
    `data: [DONE]\n\n`,
]

export const TEXT_STREAM_BODY = TEXT_STREAM_CHUNKS.join("")

/**
 * SSE fixture: Text-only streaming response
 * OpenAI Responses API format (/v1/responses)
 *
 * Fields match what @ai-sdk/openai OpenAIResponsesLanguageModel.doStream expects:
 * - response.created uses created_at (unix timestamp)
 * - response.completed uses full usage object with output_tokens_details
 * - text deltas use item_id field (not just delta)
 */
export const RESPONSES_API_CHUNKS = [
    // response.created — triggers responseId tracking
    `data: {"type":"response.created","response":{"id":"resp_test123","object":"response","created_at":1700000000,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,

    // output_item.added with type=message — triggers text-start in AI SDK
    `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_test123","role":"assistant","content":[]}}\n\n`,

    // content_part.added
    `data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n`,

    // text deltas — these produce text-delta events in AI SDK
    `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test123","delta":"Hello"}\n\n`,
    `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test123","delta":"! How"}\n\n`,
    `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test123","delta":" can I"}\n\n`,
    `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test123","delta":" help you?"}\n\n`,

    // output_text.done
    `data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"Hello! How can I help you?"}\n\n`,

    // content_part.done
    `data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello! How can I help you?"}}\n\n`,

    // output_item.done with type=message — triggers text-end in AI SDK
    `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_test123","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you?"}]}}\n\n`,

    // response.completed — triggers finish with usage
    `data: {"type":"response.completed","response":{"id":"resp_test123","object":"response","created_at":1700000000,"model":"gpt-4o","status":"completed","output":[{"type":"message","id":"msg_test123","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you?"}]}],"usage":{"input_tokens":10,"output_tokens":8,"total_tokens":18,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
]

export const RESPONSES_API_BODY = RESPONSES_API_CHUNKS.join("")

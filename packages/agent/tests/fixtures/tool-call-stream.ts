/**
 * SSE fixtures: tool call flow in OpenAI Responses API format
 * 
 * Round 1: Model calls write_file tool (function_call output item)
 * Round 2: After tool result, model responds with text
 */

// Round 1: Model calls write_file tool via function_call
export const TOOL_CALL_CHUNKS = [
    `data: {"type":"response.created","response":{"id":"resp_tool001","object":"response","created_at":1700000000,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,

    // function_call output item added
    `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_test001","call_id":"call_write_file_001","name":"write_file","arguments":"","status":"in_progress"}}\n\n`,

    // function call arguments delta
    `data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_test001","delta":"{\\"filePath\\":\\"hello.ts\\",\\"content\\":\\"console.log(\\\\n\\"}"}\n\n`,

    // function_call output item done
    `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_test001","call_id":"call_write_file_001","name":"write_file","arguments":"{\\"filePath\\":\\"hello.ts\\",\\"content\\":\\"console.log(\\\\n\\"}","status":"completed"}}\n\n`,

    // response completed (with function call, no text output)
    `data: {"type":"response.completed","response":{"id":"resp_tool001","object":"response","created_at":1700000000,"model":"gpt-4o","status":"completed","output":[{"type":"function_call","id":"fc_test001","call_id":"call_write_file_001","name":"write_file","arguments":"{\\"filePath\\":\\"hello.ts\\",\\"content\\":\\"console.log(\\\\n\\"}","status":"completed"}],"usage":{"input_tokens":100,"output_tokens":15,"total_tokens":115,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
]

// Round 2: After tool result, model responds with text
export const TOOL_RESULT_TEXT_CHUNKS = [
    `data: {"type":"response.created","response":{"id":"resp_tool002","object":"response","created_at":1700000001,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
    `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_tool002","role":"assistant","content":[]}}\n\n`,
    `data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n`,
    `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_tool002","delta":"I have created the file hello.ts for you."}\n\n`,
    `data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"I have created the file hello.ts for you."}\n\n`,
    `data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"I have created the file hello.ts for you."}}\n\n`,
    `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_tool002","role":"assistant","content":[{"type":"output_text","text":"I have created the file hello.ts for you."}]}}\n\n`,
    `data: {"type":"response.completed","response":{"id":"resp_tool002","object":"response","created_at":1700000001,"model":"gpt-4o","status":"completed","output":[{"type":"message","id":"msg_tool002","role":"assistant","content":[{"type":"output_text","text":"I have created the file hello.ts for you."}]}],"usage":{"input_tokens":150,"output_tokens":10,"total_tokens":160,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
]

export const TOOL_CALL_BODY = TOOL_CALL_CHUNKS.join("")
export const TOOL_RESULT_TEXT_BODY = TOOL_RESULT_TEXT_CHUNKS.join("")

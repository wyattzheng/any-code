import { createChatAgent } from "./dist/index.js";

const agent = createChatAgent('claudecode', { apiKey: 'mock', terminal: { exists: () => true, write: () => {}, read: () => "", create: () => {}, destroy: () => {} }, preview: { setPreviewTarget: () => {} } });
const stream = agent.chat('Hi');
(async () => {
    try {
        for await (const chunk of stream) {
            console.log(chunk);
            if (chunk.type === "done") break;
        }
    } catch (e) { console.error('AGENT ERROR:', e) }
})()

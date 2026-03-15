import { defineConfig } from "tsup"

export default defineConfig({
    entry: {
        "index":             "src/index.ts",
        "code-agent":        "src/code-agent.ts",
        "storage/index":     "src/storage/index.ts",
        "util/search":       "src/util/search.ts",
        "util/git":          "src/util/git.ts",
        "util/markdown":     "src/util/markdown.ts",
        "project/index":     "src/project/index.ts",
        "session/index":     "src/session/index.ts",
        "memory/message-v2": "src/memory/message-v2.ts",
        "skill/index":       "src/skill/index.ts",
    },
    format: ["esm"],
    platform: "node",
    splitting: true,
    clean: true,
    dts: false,
})

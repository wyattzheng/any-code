import { testPaths } from "./_test-paths"
/**
 * Test: Snapshot tracking and revert through agent conversation flow
 *
 * END-TO-END integration tests verifying:
 *   1. Agent chat → write tool → file created on real filesystem
 *   2. Snapshot.track() before/after captures the changes
 *   3. Snapshot.patch() detects files changed during agent chat
 *   4. Snapshot.revert() restores filesystem to pre-chat state
 *   5. Snapshot.diffFull() shows structured diff of agent-made changes
 *   6. Multiple agent chats with selective revert
 *
 * Uses real NodeFS + git repo (Snapshot relies on git), MSW for LLM mocking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { http, HttpResponse } from "msw"
import path from "path"
import fs from "fs"
import { execSync } from "child_process"
import { CodeAgent, NodeFS } from "../src/index"
import { createTempDir, cleanupTempDir, server } from "./setup"
import { buildHelloworldFixtures } from "./fixtures/helloworld-html-stream"
import { RESPONSES_API_BODY } from "./fixtures/text-stream"
import { SqlJsStorage } from "../src/storage-sqljs"
import { Snapshot } from "@any-code/opencode/snapshot/index"

/** Build SSE mock for a write tool call creating a new file */
function buildWriteNewFileMock(filePath: string, content: string) {
    const args = JSON.stringify({ filePath, content })
    const escaped = JSON.stringify(args).slice(1, -1)
    const CONFIRM = "Done."

    const toolCallBody = [
        `data: {"type":"response.created","response":{"id":"resp_w","object":"response","created_at":1700000000,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
        `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"","status":"in_progress"}}\n\n`,
        `data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_w","delta":"${escaped}"}\n\n`,
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"${escaped}","status":"completed"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_w","object":"response","created_at":1700000000,"model":"gpt-4o","status":"completed","output":[{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"${escaped}","status":"completed"}],"usage":{"input_tokens":100,"output_tokens":30,"total_tokens":130,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
    ].join("")

    const confirmationBody = [
        `data: {"type":"response.created","response":{"id":"resp_c","object":"response","created_at":1700000001,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
        `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_c","role":"assistant","content":[]}}\n\n`,
        `data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n`,
        `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_c","delta":"${CONFIRM}"}\n\n`,
        `data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"${CONFIRM}"}\n\n`,
        `data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"${CONFIRM}"}}\n\n`,
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_c","role":"assistant","content":[{"type":"output_text","text":"${CONFIRM}"}]}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_c","object":"response","created_at":1700000001,"model":"gpt-4o","status":"completed","output":[{"type":"message","id":"msg_c","role":"assistant","content":[{"type":"output_text","text":"${CONFIRM}"}]}],"usage":{"input_tokens":200,"output_tokens":10,"total_tokens":210,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
    ].join("")

    return { toolCallBody, confirmationBody }
}

/**
 * Build SSE mock for read + write tool calls (modify existing file).
 * Round 1: LLM calls "read" to read the file
 * Round 2: After read result, LLM calls "write" to overwrite the file
 * Round 3: After write result, LLM sends confirmation text
 */
function buildReadWriteMock(filePath: string, newContent: string) {
    const readArgs = JSON.stringify({ filePath })
    const readEscaped = JSON.stringify(readArgs).slice(1, -1)

    const writeArgs = JSON.stringify({ filePath, content: newContent })
    const writeEscaped = JSON.stringify(writeArgs).slice(1, -1)

    const CONFIRM = "Updated."

    // Round 1: read tool call
    const readBody = [
        `data: {"type":"response.created","response":{"id":"resp_r","object":"response","created_at":1700000000,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
        `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_r","call_id":"call_r","name":"read","arguments":"","status":"in_progress"}}\n\n`,
        `data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_r","delta":"${readEscaped}"}\n\n`,
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_r","call_id":"call_r","name":"read","arguments":"${readEscaped}","status":"completed"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_r","object":"response","created_at":1700000000,"model":"gpt-4o","status":"completed","output":[{"type":"function_call","id":"fc_r","call_id":"call_r","name":"read","arguments":"${readEscaped}","status":"completed"}],"usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
    ].join("")

    // Round 2: write tool call
    const writeBody = [
        `data: {"type":"response.created","response":{"id":"resp_w","object":"response","created_at":1700000001,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
        `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"","status":"in_progress"}}\n\n`,
        `data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_w","delta":"${writeEscaped}"}\n\n`,
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"${writeEscaped}","status":"completed"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_w","object":"response","created_at":1700000001,"model":"gpt-4o","status":"completed","output":[{"type":"function_call","id":"fc_w","call_id":"call_w","name":"write","arguments":"${writeEscaped}","status":"completed"}],"usage":{"input_tokens":200,"output_tokens":30,"total_tokens":230,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
    ].join("")

    // Round 3: confirmation text
    const confirmBody = [
        `data: {"type":"response.created","response":{"id":"resp_cf","object":"response","created_at":1700000002,"model":"gpt-4o","status":"in_progress","output":[]}}\n\n`,
        `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_cf","role":"assistant","content":[]}}\n\n`,
        `data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n`,
        `data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_cf","delta":"${CONFIRM}"}\n\n`,
        `data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"${CONFIRM}"}\n\n`,
        `data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"${CONFIRM}"}}\n\n`,
        `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_cf","role":"assistant","content":[{"type":"output_text","text":"${CONFIRM}"}]}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"resp_cf","object":"response","created_at":1700000002,"model":"gpt-4o","status":"completed","output":[{"type":"message","id":"msg_cf","role":"assistant","content":[{"type":"output_text","text":"${CONFIRM}"}]}],"usage":{"input_tokens":300,"output_tokens":10,"total_tokens":310,"output_tokens_details":{"reasoning_tokens":0},"input_tokens_details":{"cached_tokens":0}}}}\n\n`,
    ].join("")

    return { readBody, writeBody, confirmBody }
}

/** Install MSW handler for a new file write mock */
function installWriteNewMock(filePath: string, content: string) {
    let callCount = 0
    const { toolCallBody, confirmationBody } = buildWriteNewFileMock(filePath, content)
    server.use(
        http.post("*/v1/responses", async ({ request }) => {
            const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>
            const model = (body?.model ?? "") as string
            if (model !== "gpt-4o") {
                return new HttpResponse(RESPONSES_API_BODY, {
                    headers: { "Content-Type": "text/event-stream" },
                })
            }
            callCount++
            return new HttpResponse(callCount === 1 ? toolCallBody : confirmationBody, {
                headers: { "Content-Type": "text/event-stream" },
            })
        }),
    )
}

/** Install MSW handler for a read+write mock (modify existing file) */
function installReadWriteMock(filePath: string, newContent: string) {
    let callCount = 0
    const { readBody, writeBody, confirmBody } = buildReadWriteMock(filePath, newContent)
    server.use(
        http.post("*/v1/responses", async ({ request }) => {
            const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>
            const model = (body?.model ?? "") as string
            if (model !== "gpt-4o") {
                return new HttpResponse(RESPONSES_API_BODY, {
                    headers: { "Content-Type": "text/event-stream" },
                })
            }
            callCount++
            const responseBody = callCount === 1 ? readBody : callCount === 2 ? writeBody : confirmBody
            return new HttpResponse(responseBody, {
                headers: { "Content-Type": "text/event-stream" },
            })
        }),
    )
}

describe("Snapshot: agent conversation → snapshot → revert", () => {
    let tmpDir: string
    let agent: CodeAgent
    let paths: ReturnType<typeof testPaths>

    beforeAll(async () => {
        tmpDir = createTempDir("snapshot-flow-")
        paths = testPaths()

        // Initialize a real git repo — snapshot requires git
        execSync("git init --quiet", { cwd: tmpDir })
        execSync("git config user.email 'test@test.com'", { cwd: tmpDir })
        execSync("git config user.name 'Test'", { cwd: tmpDir })

        // Create baseline file and commit
        fs.writeFileSync(path.join(tmpDir, "existing.ts"), "export const ORIGINAL = true\n")
        execSync("git add .", { cwd: tmpDir })
        execSync("git commit -m 'init' --quiet", { cwd: tmpDir })

        agent = new CodeAgent({
            storage: new SqlJsStorage(),
            directory: tmpDir,
            worktree: tmpDir,
            skipPlugins: true,
            fs: new NodeFS(),
            paths,
            provider: {
                id: "openai",
                apiKey: "test-key-not-real",
                model: "gpt-4o",
                baseUrl: "http://localhost:19283/v1",
            },
            project: {
                id: "prj_snapshot_flow" as any,
                worktree: tmpDir,
                vcs: "git",
                time: { created: Date.now(), updated: Date.now() },
                sandboxes: [],
            } as any,
        })
        await agent.init()
    }, 60_000)

    afterAll(() => cleanupTempDir(tmpDir))

    it("agent chat creates a new file → snapshot detects the change", async () => {
        const ctx = agent.agentContext
        const targetFile = path.join(tmpDir, "created-by-agent.ts")

        // Snapshot BEFORE
        const hashBefore = await Snapshot.track(ctx)

        // Mock LLM to create a new file
        installWriteNewMock("created-by-agent.ts", "export const CREATED = true\n")

        const session = await agent.createSession()
        const events: Array<{ type: string; toolName?: string }> = []
        for await (const event of agent.chat(session.id, "Create a file")) {
            events.push(event)
        }

        // Verify write tool was called
        expect(events.some(e => e.type === "tool_call_start" && e.toolName === "write")).toBe(true)
        // Verify file exists
        expect(fs.existsSync(targetFile)).toBe(true)
        expect(fs.readFileSync(targetFile, "utf-8")).toBe("export const CREATED = true\n")

        // Snapshot should detect the file creation
        const patchResult = await Snapshot.patch(ctx, hashBefore!)
        expect(patchResult.files.some(f => f.includes("created-by-agent.ts"))).toBe(true)

        // diffFull should show it as "added"
        const hashAfter = await Snapshot.track(ctx)
        const diffs = await Snapshot.diffFull(ctx, hashBefore!, hashAfter!)
        const addedDiff = diffs.find(d => d.file.includes("created-by-agent.ts"))
        expect(addedDiff).toBeDefined()
        expect(addedDiff!.status).toBe("added")
        expect(addedDiff!.additions).toBeGreaterThan(0)
        expect(addedDiff!.after).toContain("CREATED")
    })

    it("revert agent-created file → file deleted", async () => {
        const ctx = agent.agentContext
        const targetFile = path.join(tmpDir, "to-be-reverted.ts")

        // Snapshot BEFORE — file doesn't exist
        const hashBefore = await Snapshot.track(ctx)
        expect(fs.existsSync(targetFile)).toBe(false)

        // Agent creates the file
        installWriteNewMock("to-be-reverted.ts", "export const TEMP = 'will be reverted'\n")
        const session = await agent.createSession()
        for await (const _event of agent.chat(session.id, "Create a temp file")) {}

        // Verify file was created
        expect(fs.existsSync(targetFile)).toBe(true)

        // Revert using snapshot
        const patchResult = await Snapshot.patch(ctx, hashBefore!)
        expect(patchResult.files.some(f => f.includes("to-be-reverted.ts"))).toBe(true)

        await Snapshot.revert(ctx, [patchResult])

        // File should be deleted
        expect(fs.existsSync(targetFile)).toBe(false)
        // Other files still intact
        expect(fs.readFileSync(path.join(tmpDir, "existing.ts"), "utf-8")).toBe("export const ORIGINAL = true\n")
    })

    it("agent reads then modifies an existing file → revert restores original", async () => {
        const ctx = agent.agentContext
        const targetFile = path.join(tmpDir, "mutable.ts")

        // Create the file first
        fs.writeFileSync(targetFile, "export const VALUE = 'original'\n")
        execSync("git add . && git commit -m 'add mutable' --quiet", { cwd: tmpDir })

        // Snapshot BEFORE
        const hashBefore = await Snapshot.track(ctx)

        // Mock: LLM reads mutable.ts first, then writes new content
        installReadWriteMock("mutable.ts", "export const VALUE = 'modified by agent'\n")

        const session = await agent.createSession()
        const events: Array<{ type: string; toolName?: string }> = []
        for await (const event of agent.chat(session.id, "Update mutable.ts")) {
            events.push(event)
        }

        // Verify read and write tools were called
        const toolNames = events.filter(e => e.type === "tool_call_start").map(e => e.toolName)
        expect(toolNames).toContain("read")
        expect(toolNames).toContain("write")

        // Verify file was modified
        expect(fs.readFileSync(targetFile, "utf-8")).toBe("export const VALUE = 'modified by agent'\n")

        // Revert using snapshot
        const patchResult = await Snapshot.patch(ctx, hashBefore!)
        expect(patchResult.files.some(f => f.includes("mutable.ts"))).toBe(true)

        await Snapshot.revert(ctx, [patchResult])

        // File should be restored
        expect(fs.readFileSync(targetFile, "utf-8")).toBe("export const VALUE = 'original'\n")
    })

    it("two agent chats create files → revert only the second one", async () => {
        const ctx = agent.agentContext

        // Agent 1: creates file-a.ts
        installWriteNewMock("file-a.ts", "export const A = 1\n")
        const s1 = await agent.createSession()
        for await (const _event of agent.chat(s1.id, "Create file-a")) {}
        expect(fs.existsSync(path.join(tmpDir, "file-a.ts"))).toBe(true)

        // Snapshot between the two chats
        const hashMiddle = await Snapshot.track(ctx)

        // Agent 2: creates file-b.ts
        installWriteNewMock("file-b.ts", "export const B = 2\n")
        const s2 = await agent.createSession()
        for await (const _event of agent.chat(s2.id, "Create file-b")) {}
        expect(fs.existsSync(path.join(tmpDir, "file-b.ts"))).toBe(true)

        // Revert only changes after the middle snapshot
        const patchSecond = await Snapshot.patch(ctx, hashMiddle!)
        expect(patchSecond.files.some(f => f.includes("file-b.ts"))).toBe(true)
        // file-a should NOT be in this patch since it was created before hashMiddle
        expect(patchSecond.files.some(f => f.includes("file-a.ts"))).toBe(false)

        await Snapshot.revert(ctx, [patchSecond])

        // file-b gone, file-a remains
        expect(fs.existsSync(path.join(tmpDir, "file-b.ts"))).toBe(false)
        expect(fs.existsSync(path.join(tmpDir, "file-a.ts"))).toBe(true)
        expect(fs.readFileSync(path.join(tmpDir, "file-a.ts"), "utf-8")).toBe("export const A = 1\n")
    })

    it("diffFull shows structured diff after agent modifies a file", async () => {
        const ctx = agent.agentContext
        const targetFile = path.join(tmpDir, "diff-check.ts")

        // Create initial file
        fs.writeFileSync(targetFile, "export const X = 'before'\n")
        const hashBefore = await Snapshot.track(ctx)

        // Agent modifies it (read + write)
        installReadWriteMock("diff-check.ts", "export const X = 'after'\nexport const Y = 'added'\n")
        const session = await agent.createSession()
        for await (const _event of agent.chat(session.id, "Update diff-check")) {}

        const hashAfter = await Snapshot.track(ctx)

        const diffs = await Snapshot.diffFull(ctx, hashBefore!, hashAfter!)
        const targetDiff = diffs.find(d => d.file.includes("diff-check.ts"))
        expect(targetDiff).toBeDefined()
        expect(targetDiff!.status).toBe("modified")
        expect(targetDiff!.before).toContain("before")
        expect(targetDiff!.after).toContain("after")
        expect(targetDiff!.after).toContain("added")
        expect(targetDiff!.additions).toBeGreaterThanOrEqual(1)
    })
})

import { testPaths, testNodeDeps } from "./_test-paths"
/**
 * Test: Ephemeral chat mode
 *
 * Verifies both the low-level snapshotMessages/rollbackMessages API
 * and the end-to-end agent.chat() behavior with { ephemeral: true }.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CodeAgent, NodeFS, NodeSearchProvider } from "../src/index"
import { createTempDir, cleanupTempDir } from "./setup"
import { SqlJsStorage } from "../src/storage-sqljs"
import { MessageV2 } from "../src/memory/message-v2"
import { MessageID, PartID } from "../src/session/schema"

// ── Helper ──────────────────────────────────────────────────────────────

function createAgent(tmpDir: string) {
    return new CodeAgent({
        ...testNodeDeps(),
        storage: new SqlJsStorage(),
        directory: tmpDir,
        fs: new NodeFS(),
        search: new NodeSearchProvider(),
        dataPath: testPaths(),
        provider: {
            id: "openai",
            apiKey: "test-key-not-real",
            model: "gpt-4o",
            baseUrl: "http://localhost:19283/v1",
        },
    })
}

// ── Unit tests: snapshotMessages / rollbackMessages ─────────────────────

describe("Ephemeral: snapshotMessages / rollbackMessages", () => {
    let agent: CodeAgent
    let tmpDir: string
    let sessionId: any

    beforeAll(async () => {
        tmpDir = createTempDir()
        agent = createAgent(tmpDir)
        await agent.init()
        const session = await agent.agentContext.session.create()
        sessionId = session.id
    }, 60_000)

    afterAll(() => cleanupTempDir(tmpDir))

    function memory() { return agent.agentContext.memory }

    async function addMessage(text: string) {
        const msgId = MessageID.ascending()
        await memory().updateMessage({
            id: msgId,
            sessionID: sessionId,
            role: "user" as const,
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-4o" },
        })
        await memory().updatePart({
            id: PartID.ascending(),
            sessionID: sessionId,
            messageID: msgId,
            type: "text" as const,
            text,
        })
        return msgId
    }

    async function getMessageCount() {
        const msgs: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(agent.agentContext, sessionId)) {
            msgs.push(msg)
        }
        return msgs.length
    }

    it("rollback removes only messages created after the snapshot", async () => {
        const preExistingId = await addMessage("I existed before the snapshot")
        const countBefore = await getMessageCount()

        const snapshot = memory().snapshotMessages(sessionId)
        expect(snapshot).toContain(preExistingId)

        await addMessage("ephemeral message 1")
        await addMessage("ephemeral message 2")
        expect(await getMessageCount()).toBe(countBefore + 2)

        await memory().rollbackMessages(sessionId, snapshot)

        expect(await getMessageCount()).toBe(countBefore)
        const remaining = memory().snapshotMessages(sessionId)
        expect(remaining).toContain(preExistingId)
    })

    it("without rollback, messages accumulate", async () => {
        const countBefore = await getMessageCount()
        await addMessage("normal message 1")
        await addMessage("normal message 2")
        expect(await getMessageCount()).toBe(countBefore + 2)
    })

    it("rollback is a no-op when no new messages were added", async () => {
        await addMessage("stable message")
        const snapshot = memory().snapshotMessages(sessionId)
        const countBefore = await getMessageCount()

        await memory().rollbackMessages(sessionId, snapshot)
        expect(await getMessageCount()).toBe(countBefore)
    })
})

// ── Integration tests: agent.chat() with ephemeral option ───────────────

describe("Ephemeral: agent.chat() integration", () => {
    let agent: CodeAgent
    let tmpDir: string

    beforeAll(async () => {
        tmpDir = createTempDir()
        agent = createAgent(tmpDir)
        await agent.init()
    }, 60_000)

    afterAll(() => cleanupTempDir(tmpDir))

    function memory() { return agent.agentContext.memory }

    async function getSessionMessageCount() {
        const msgs: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(agent.agentContext, agent.sessionId as any)) {
            msgs.push(msg)
        }
        return msgs.length
    }

    it("normal chat should persist messages in session", async () => {
        const countBefore = await getSessionMessageCount()

        // Normal chat (ephemeral=false by default)
        for await (const event of agent.chat("Say Hello World")) {
            // consume all events
        }

        const countAfter = await getSessionMessageCount()
        // Should have at least user message + assistant message
        expect(countAfter).toBeGreaterThan(countBefore)
    })

    it("ephemeral chat should NOT leave messages in session", async () => {
        const countBefore = await getSessionMessageCount()

        // Ephemeral chat
        for await (const event of agent.chat("Say Hello Again", { ephemeral: true })) {
            // consume all events
        }

        const countAfter = await getSessionMessageCount()
        // Messages from this chat should have been cleaned up
        expect(countAfter).toBe(countBefore)
    })

    it("ephemeral chat should still stream events normally", async () => {
        const events: Array<{ type: string; content?: string }> = []

        for await (const event of agent.chat("Tell me a joke", { ephemeral: true })) {
            events.push(event)
        }

        // Should have text.delta events (chat still works)
        const textEvents = events.filter(e => e.type === "text.delta")
        expect(textEvents.length).toBeGreaterThan(0)

        // Should end with done event
        expect(events[events.length - 1].type).toBe("done")
    })

    it("messages from previous non-ephemeral chats should survive ephemeral calls", async () => {
        // First: normal chat to create some messages
        for await (const event of agent.chat("Normal message 1")) { }
        const countAfterNormal = await getSessionMessageCount()
        expect(countAfterNormal).toBeGreaterThan(0)

        // Second: ephemeral chat
        for await (const event of agent.chat("Ephemeral message", { ephemeral: true })) { }

        // Third: check that the normal messages are still there
        const countAfterEphemeral = await getSessionMessageCount()
        expect(countAfterEphemeral).toBe(countAfterNormal)
    })
})

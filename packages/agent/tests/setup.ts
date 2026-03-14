/**
 * Test setup for CodeAgent tests
 *
 * - Mock fastify (requires Node >= 20, in case running on older Node)
 * - MSW server to intercept LLM HTTP calls
 * - Temp directory factory for isolated test environments
 */
import { vi, beforeAll, afterAll, afterEach } from "vitest"

// ── Mock fastify before any opencode imports ────────────────────────────────
vi.mock("fastify", () => ({
    default: () => ({
        listen: vi.fn(),
        close: vi.fn(),
        register: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        route: vi.fn(),
        ready: vi.fn().mockResolvedValue(undefined),
    }),
    fastify: () => ({
        listen: vi.fn(),
        close: vi.fn(),
        register: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        route: vi.fn(),
        ready: vi.fn().mockResolvedValue(undefined),
    }),
}))

import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { TEXT_STREAM_BODY, RESPONSES_API_BODY } from "./fixtures/text-stream"
import fs from "fs"
import path from "path"
import os from "os"

// ── MSW Server ──────────────────────────────────────────────────────────────

const handlers = [
    // OpenAI Responses API (used by @ai-sdk/openai)
    http.post("*/v1/responses", () => {
        return new HttpResponse(RESPONSES_API_BODY, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        })
    }),
    // OpenAI Chat Completions API (used by @ai-sdk/openai-compatible)
    http.post("*/v1/chat/completions", () => {
        return new HttpResponse(TEXT_STREAM_BODY, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        })
    }),
    // Catch model listing calls
    http.get("*/v1/models", () => {
        return HttpResponse.json({
            object: "list",
            data: [
                { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "test" },
            ],
        })
    }),
]

export const server = setupServer(...handlers)

// ── Temp Directory ──────────────────────────────────────────────────────────

export function createTempDir(prefix = "agent-test-"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function cleanupTempDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true })
    } catch {
        // ignore cleanup errors
    }
}

// ── MSW Lifecycle ───────────────────────────────────────────────────────────

beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" })
})

afterEach(() => {
    server.resetHandlers()
})

afterAll(() => {
    server.close()
})

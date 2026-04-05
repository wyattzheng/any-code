/**
 * IChatAgent — Unified chat agent interface for AnyCode.
 *
 * Abstracts over different agent backends (AnyCode native, Claude Code SDK, etc.)
 * so that the server's WebSocket chat handler only consumes a single interface.
 *
 * The active backend is selected from the current account in settings.json:
 *   anycode      → AnyCodeAgent (default, wraps CodeAgent from @any-code/agent)
 *   claudecode   → ClaudeCodeAgent (from @any-code/claude-code-agent)
 *   codex        → CodexAgent (from @any-code/codex-agent)
 */

import { CodeAgent, type CodeAgentEvent, type CodeAgentOptions, type TerminalProvider, type PreviewProvider } from "@any-code/agent"
import type { IChatAgent, ChatAgentConfig, ChatAgentEvent } from "@any-code/utils"

// Re-export shared types for consumers
export type { IChatAgent, ChatAgentConfig, ChatAgentEvent }
export type { CodeAgentEvent }

// ── AnyCodeAgent ─────────────────────────────────────────────────────────

/**
 * AnyCodeAgent — internally creates and owns a CodeAgent instance.
 * Delegates all IChatAgent methods to the underlying CodeAgent.
 */
export class AnyCodeAgent implements IChatAgent {
  readonly name: string
  private config: ChatAgentConfig
  private _codeAgent: InstanceType<typeof CodeAgent>
  private _initialized = false

  constructor(config: ChatAgentConfig) {
    this.config = config
    this.name = config.name || "AnyCode Agent"
    if (!config.codeAgentOptions) {
      throw new Error("AnyCodeAgent requires codeAgentOptions in ChatAgentConfig")
    }
    this._codeAgent = new CodeAgent(config.codeAgentOptions)
  }

  async init(): Promise<void> {
    if (!this._initialized) {
      this._initialized = true
      await this._codeAgent.init()
    }
  }

  get sessionId(): string {
    return this._codeAgent.sessionId
  }

  async *chat(input: string): AsyncGenerator<ChatAgentEvent, void, unknown> {
    await this.init()
    yield* this._codeAgent.chat(input)
  }

  async abort(): Promise<void> {
    if (!this._initialized) return
    await this._codeAgent.abort()
  }

  async destroy(): Promise<void> {
    if (!this._initialized) return
    try {
      await this._codeAgent.abort()
    } catch { /* ignore */ }
  }

  on(event: string, handler: (data: any) => void): void {
    this._codeAgent.on(event, handler)
  }

  setWorkingDirectory(dir: string): void {
    this._codeAgent.setWorkingDirectory(dir)
  }

  async getUsage(): Promise<any> {
    return this._codeAgent.getUsage()
  }

  async getContext(): Promise<any> {
    return this._codeAgent.getContext()
  }

  getSessionMessages(opts: { limit: number }): Promise<any> {
    return this._codeAgent.getSessionMessages(opts)
  }
}

interface NoAgentMessageRecord {
  role: "user" | "assistant"
  text: string
  createdAt: number
}

/**
 * NoAgent — placeholder agent used when no account is configured.
 * Keeps the window/session alive and responds with a setup hint.
 */
export class NoAgent implements IChatAgent {
  readonly name: string
  private readonly config: ChatAgentConfig & { noAgentSessionId?: string }
  private readonly _sessionId: string
  private _initialized = false
  private _history: NoAgentMessageRecord[] = []

  constructor(config: ChatAgentConfig) {
    this.config = config as ChatAgentConfig & { noAgentSessionId?: string }
    this.name = config.name || "No Agent"
    this._sessionId = this.config.noAgentSessionId || `noagent-${Date.now()}`
  }

  get sessionId(): string {
    return this._sessionId
  }

  async init(): Promise<void> {
    if (this._initialized) return
    this._initialized = true
  }

  on(_event: string, _handler: (data: any) => void): void {
    // NoAgent doesn't emit runtime events
  }

  setWorkingDirectory(_dir: string): void {
    // No-op
  }

  async getUsage(): Promise<any> {
    return null
  }

  async getContext(): Promise<any> {
    return null
  }

  async getSessionMessages(opts: { limit: number }): Promise<any> {
    await this.init()
    const limit = Math.max(0, opts?.limit ?? 30)
    return this._history.slice(-limit).map((message, index) => (
      message.role === "user"
        ? {
          id: `${this._sessionId}-user-${index}`,
          role: "user",
          text: message.text,
          createdAt: message.createdAt,
        }
        : {
          id: `${this._sessionId}-assistant-${index}`,
          role: "assistant",
          parts: [{ type: "text", content: message.text }],
          createdAt: message.createdAt,
        }
    ))
  }

  abort(): void {
    // No-op
  }

  destroy(): void {
    this._history = []
  }

  async *chat(input: string): AsyncGenerator<ChatAgentEvent, void, unknown> {
    await this.init()

    const userMessage: NoAgentMessageRecord = {
      role: "user",
      text: input,
      createdAt: Date.now(),
    }
    this._history.push(userMessage)

    const assistantText = "当前还没有配置可用账号。请先打开设置，添加账号的 AGENT、PROVIDER、MODEL、API_KEY 和 BASE_URL，然后再继续对话。"
    const assistantMessage: NoAgentMessageRecord = {
      role: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    }
    this._history.push(assistantMessage)

    yield { type: "text.delta", content: assistantText }
    yield { type: "done" }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/** Create the appropriate IChatAgent based on agent type string */
export async function createChatAgent(agentType: string, config: ChatAgentConfig): Promise<IChatAgent> {
  if (agentType === "noagent") {
    return new NoAgent(config)
  }
  if (agentType === "claudecode") {
    const { ClaudeCodeAgent } = await import("@any-code/claude-code-agent")
    return new ClaudeCodeAgent(config)
  }
  if (agentType === "codex") {
    const { CodexAgent } = await import("@any-code/codex-agent")
    return new CodexAgent(config)
  }
  if (agentType === "antigravity") {
    const { AntigravityAgent } = await import("@any-code/antigravity-agent")
    return new AntigravityAgent(config)
  }
  return new AnyCodeAgent(config)
}

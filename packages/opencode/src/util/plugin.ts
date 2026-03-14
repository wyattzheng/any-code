/**
 * Plugin system stub — original plugin system removed during agent-mode cleanup.
 * Internal plugins (Codex/Copilot/GitLab OAuth) are not needed.
 * This stub provides the minimal interface used by config, session, tool, and provider modules.
 */
import { Config } from "../config/config"
import { Log } from "../util/log"
import z from "zod"

// Inline ToolDefinition type (was in @opencode-ai/plugin)
export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: { permission: string; patterns: string[]; always: string[]; metadata: { [key: string]: any } }): Promise<void>
}

export type ToolDefinition = {
  description: string
  args: z.ZodRawShape
  execute(args: any, context: ToolContext): Promise<string>
}

// Inline Hooks type (was in @opencode-ai/plugin)
export interface Hooks {
  tool?: { [key: string]: ToolDefinition }
  auth?: { provider: string; loader?: (...args: any[]) => any; methods: any[] }
  [key: string]: any
}

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  /** No-op init — plugin system removed */
  export async function init() {
    log.info("plugin system disabled (agent mode)")
  }

  /** Always returns empty list */
  export async function list(): Promise<{ auth?: Hooks["auth"]; [key: string]: any }[]> {
    return []
  }

  /** Returns empty hooks object */
  export function hooks(): Hooks {
    return {}
  }

  /** No-op — always resolves empty plugin tools */
  export async function tools(): Promise<Record<string, ToolDefinition>> {
    return {}
  }

  /** No-op trigger — plugin hooks disabled, returns output as-is */
  export async function trigger<T>(_hook: string, _input: any, output: T): Promise<T> { return output }
}

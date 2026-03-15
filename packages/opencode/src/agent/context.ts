import { Project } from "../project/project"
import { VFS } from "../util/vfs"
import { SearchProvider } from "../util/search"
import type { GitProvider } from "../util/git"
import type { EnvService } from "../util/env"
import type { BusService } from "../bus"
import type { SchedulerService } from "../util/scheduler"
import type { FileTimeService } from "../file/time"
import type { Config } from "../config/config"
import type { Question } from "../session/question"
import type { SessionStatus } from "../session/status"
import type { InstructionPrompt } from "../session/instruction"
import type { SessionPrompt } from "../session/prompt"
import type { Permission } from "../permission"
import type { PermissionNext } from "../permission/next"
import type { Command } from "../command"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"
import type { ModelsDev } from "../provider/models"
import type { ToolRegistry } from "../tool/registry"
import type { Skill } from "../skill/skill"
import type { FileWatcher } from "../file/watcher"
import type { File } from "../file"
import type { Vcs } from "../project/vcs"

export interface InstancePaths {
    data: string
    bin: string
    log: string
    cache: string
    config: string
    state: string
    home: string
}

export interface AgentContext {
    /** Current working directory for the agent execution */
    directory: string
    /** The resolved root of the project/worktree */
    worktree: string
    /** Project metadata and id */
    project: Project.Info
    /** Virtual File System implementation */
    fs: VFS
    /** Git command executor */
    git: GitProvider
    /** Search Provider implementation */
    search: SearchProvider
    /** Common local paths specific to this context */
    paths: InstancePaths
    /** Function to determine if a path is considered within the working scope */
    containsPath: (filepath: string) => boolean
    /** Injected config overrides (optional, used by CodeAgent to bypass file-based config) */
    configOverrides?: Record<string, unknown>
    /** Instructions overrides (optional) */
    instructions?: string[]
    /** Database client — set during init, used for all DB operations */
    db: any
    /** Per-instance module state. Legacy, being phased out. */
    state: Map<any, any>

    // ── Service instances ──────────────────────────────────────────
    // Phase 0: stateless services (created in CodeAgent constructor)
    env: EnvService
    bus: BusService
    scheduler: SchedulerService
    fileTime: FileTimeService

    // Phase 1+: context-dependent services (created in CodeAgent.init())
    config: Config.ConfigService
    question: Question.QuestionService
    sessionStatus: SessionStatus.SessionStatusService
    instruction: InstructionPrompt.InstructionService
    sessionPrompt: SessionPrompt.SessionPromptService
    permission: Permission.PermissionService
    permissionNext: PermissionNext.PermissionNextService
    command: Command.CommandService
    agents: Agent.AgentService
    provider: Provider.ProviderService
    modelsDev: ModelsDev.ModelsDevService
    toolRegistry: ToolRegistry.ToolRegistryService
    skill: Skill.SkillService
    fileWatcher: FileWatcher.FileWatcherService
    file: File.FileService
    vcs: Vcs.VcsService
}

/**
 * Get or lazily initialize module-scoped state on the context.
 * Each module uses a unique key (typically a Symbol) to avoid collisions.
 * @deprecated Being phased out in favor of typed service properties.
 */
export function getState<T>(context: AgentContext, key: any, init: () => T): T {
    if (context.state.has(key)) return context.state.get(key)!
    const s = init()
    context.state.set(key, s)
    return s
}

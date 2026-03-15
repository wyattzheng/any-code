/**
 * @any-code/agent — re-exports from @any-code/opencode
 *
 * CodeAgent now lives in the opencode package for direct access to all services.
 * This package re-exports everything for backward compatibility.
 */

export {
    CodeAgent,
    type CodeAgentOptions,
    type CodeAgentProvider,
    type CodeAgentSession,
    type CodeAgentEvent,
    type CodeAgentEventType,
    type StorageProvider,
    type Migration,
} from "@any-code/opencode"

// VFS stays here (Node-specific implementations)
export type { VirtualFileSystem, VFSStat, VFSDirEntry } from "./vfs"
export { NodeFS } from "./vfs-node"
export { NodeSearchProvider } from "./search-node"

// Storage implementations (owned by this package)
export { SqlJsStorage } from "./storage-sqljs"


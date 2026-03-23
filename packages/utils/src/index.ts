/**
 * @any-code/utils — Node.js platform implementations
 *
 * Provides concrete implementations of VFS, Search, and Storage
 * interfaces for the Node.js platform.
 */

// Interfaces
export type { VirtualFileSystem, VFSStat, VFSDirEntry, GrepOptions, GrepMatch } from "./vfs"
export type { StorageProvider, Migration } from "./storage"

// Implementations
export { NodeFS } from "./vfs-node"
export { NodeSearchProvider } from "./search-node"
export { SqlJsStorage } from "./storage-sqljs"

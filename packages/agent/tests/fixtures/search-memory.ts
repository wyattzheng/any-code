/**
 * InMemorySearchProvider — in-memory implementation of SearchProvider.
 *
 * Works with InMemoryFS: iterates stored files, regex-matches content.
 * No external binaries needed.
 */
import path from "path"
import type { SearchProvider, GrepMatch } from "../src/index"
import type { InMemoryFS } from "./in-memory-fs"

export class InMemorySearchProvider implements SearchProvider {
    constructor(private readonly memfs: InMemoryFS) {}

    async grep(options: {
        pattern: string
        path: string
        include?: string
        maxLineLength?: number
        signal?: AbortSignal
    }): Promise<GrepMatch[]> {
        options.signal?.throwIfAborted()

        const regex = new RegExp(options.pattern)
        const results: GrepMatch[] = []
        const searchPath = options.path.endsWith("/") ? options.path : options.path + "/"

        for (const [filePath, content] of this.memfs.entries()) {
            if (!filePath.startsWith(searchPath)) continue

            // Exclude .git directory
            const relativePath = filePath.slice(searchPath.length)
            if (relativePath.startsWith(".git/") || relativePath.includes("/.git/")) continue

            // Check include glob (simple *.ext matching)
            if (options.include) {
                const basename = path.basename(filePath)
                if (!simpleGlobMatch(basename, options.include)) continue
            }

            const text = typeof content === "string" ? content : new TextDecoder().decode(content)
            const lines = text.split("\n")

            for (let i = 0; i < lines.length; i++) {
                const match = regex.exec(lines[i])
                if (match) {
                    let content = lines[i]
                    if (options.maxLineLength !== undefined && content.length > options.maxLineLength) {
                        content = content.slice(0, options.maxLineLength) + "..."
                    }
                    results.push({
                        file: filePath,
                        line: i + 1,
                        column: match.index,
                        content,
                    })
                }
            }
        }

        return results
    }

    async listFiles(options: {
        cwd: string
        glob?: string[]
        hidden?: boolean
        follow?: boolean
        maxDepth?: number
        limit?: number
        signal?: AbortSignal
    }): Promise<string[]> {
        options.signal?.throwIfAborted()

        const cwd = options.cwd.endsWith("/") ? options.cwd : options.cwd + "/"
        const showHidden = options.hidden === true
        const limit = options.limit ?? Infinity
        const results: string[] = []

        // Parse glob patterns
        const excludePatterns: string[] = [".git"]
        const includePatterns: string[] = []
        for (const g of options.glob ?? []) {
            if (g.startsWith("!")) {
                excludePatterns.push(g.slice(1).replace(/[/*]+$/, ""))
            } else {
                includePatterns.push(g)
            }
        }

        for (const filePath of this.memfs.keys()) {
            if (results.length >= limit) break
            if (!filePath.startsWith(cwd)) continue

            const relativePath = filePath.slice(cwd.length)

            // Skip hidden
            if (!showHidden && relativePath.split("/").some((p) => p.startsWith("."))) continue

            // Check excludes
            if (excludePatterns.some((p: string) => relativePath.startsWith(p))) continue

            // Check max depth
            if (options.maxDepth !== undefined) {
                const depth = relativePath.split("/").length - 1
                if (depth > options.maxDepth) continue
            }

            // Check include patterns
            if (includePatterns.length > 0) {
                const basename = path.basename(relativePath)
                if (!includePatterns.some((p: string) => simpleGlobMatch(basename, p))) continue
            }

            results.push(relativePath)
        }

        return results
    }

    async tree(options: { cwd: string; limit?: number; signal?: AbortSignal }): Promise<string> {
        const limit = options.limit ?? 50
        const files = await this.listFiles({ cwd: options.cwd, signal: options.signal })
        interface Node {
            name: string
            children: Map<string, Node>
        }

        function dir(node: Node, name: string) {
            const existing = node.children.get(name)
            if (existing) return existing
            const next = { name, children: new Map() }
            node.children.set(name, next)
            return next
        }

        const root: Node = { name: "", children: new Map() }
        for (const file of files) {
            if (file.includes(".opencode")) continue
            const parts = file.split(/[\/\\]/)
            if (parts.length < 2) continue
            let node = root
            for (const part of parts.slice(0, -1)) {
                node = dir(node, part)
            }
        }

        function count(node: Node): number {
            let total = 0
            for (const child of node.children.values()) {
                total += 1 + count(child)
            }
            return total
        }

        const total = count(root)
        const lines: string[] = []
        const queue: { node: Node; path: string }[] = []
        
        for (const child of Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
            queue.push({ node: child, path: child.name })
        }

        let used = 0
        for (let i = 0; i < queue.length && used < limit; i++) {
            const { node, path: p } = queue[i]
            lines.push(p)
            used++
            for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
                queue.push({ node: child, path: `${p}/${child.name}` })
            }
        }

        if (total > used) lines.push(`[${total - used} truncated]`)

        return lines.join("\n")
    }
}

function simpleGlobMatch(filename: string, pattern: string): boolean {
    if (pattern === "*") return true
    if (pattern.startsWith("*.")) {
        const ext = pattern.slice(1)
        if (ext.startsWith(".{") && ext.endsWith("}")) {
            const exts = ext.slice(2, -1).split(",")
            return exts.some((e) => filename.endsWith(`.${e}`))
        }
        return filename.endsWith(ext)
    }
    return filename === pattern
}

import { dirname, extname, join, relative, resolve as pathResolve } from "./path"
import type { AgentContext } from "../context"

export namespace Filesystem {
  // ── Read operations (all via context.fs) ──────────────────────────

  export async function exists(context: AgentContext, p: string): Promise<boolean> {
    return context.fs.exists(p)
  }

  export async function isDir(context: AgentContext, p: string): Promise<boolean> {
    const s = await context.fs.stat(p)
    return s?.isDirectory ?? false
  }

  export async function stat(context: AgentContext, p: string) {
    return context.fs.stat(p)
  }

  export async function size(context: AgentContext, p: string): Promise<number> {
    const s = await context.fs.stat(p)
    return s?.size ?? 0
  }

  export async function readText(context: AgentContext, p: string): Promise<string> {
    return context.fs.readText(p)
  }

  export async function readJson<T = any>(context: AgentContext, p: string): Promise<T> {
    return JSON.parse(await readText(context, p))
  }

  export async function readBytes(context: AgentContext, p: string): Promise<Uint8Array> {
    return context.fs.readBytes(p)
  }

  export async function readArrayBuffer(context: AgentContext, p: string): Promise<ArrayBuffer> {
    const bytes = await readBytes(context, p)
    return bytes.buffer as ArrayBuffer
  }

  // ── Write operations (all via context.fs) ─────────────────────────

  export async function write(context: AgentContext, p: string, content: string | Uint8Array): Promise<void> {
    return context.fs.write(p, content)
  }

  export async function writeJson(context: AgentContext, p: string, data: unknown): Promise<void> {
    return write(context, p, JSON.stringify(data, null, 2))
  }

  export async function mkdir(context: AgentContext, p: string): Promise<void> {
    return context.fs.mkdir(p)
  }

  export async function remove(context: AgentContext, p: string): Promise<void> {
    return context.fs.remove(p)
  }

  // ── Path utilities (pure, no fs dependency) ─────────────────────────

  const MIME_MAP: Record<string, string> = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".mjs": "application/javascript", ".json": "application/json",
    ".ts": "text/typescript", ".tsx": "text/typescript",
    ".jsx": "text/javascript", ".md": "text/markdown",
    ".txt": "text/plain", ".csv": "text/csv", ".xml": "application/xml",
    ".yaml": "text/yaml", ".yml": "text/yaml", ".toml": "text/plain",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".ico": "image/x-icon", ".pdf": "application/pdf",
    ".zip": "application/zip", ".gz": "application/gzip",
    ".wasm": "application/wasm", ".mp4": "video/mp4",
    ".webm": "video/webm", ".mp3": "audio/mpeg",
    ".sh": "text/x-shellscript", ".py": "text/x-python",
    ".rb": "text/x-ruby", ".go": "text/x-go", ".rs": "text/x-rust",
    ".java": "text/x-java", ".c": "text/x-c", ".cpp": "text/x-c++",
    ".h": "text/x-c", ".hpp": "text/x-c++",
  }

  export function mimeType(p: string): string {
    return MIME_MAP[extname(p).toLowerCase()] || "application/octet-stream"
  }

  export function resolve(p: string): string {
    return pathResolve(p)
  }

  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  export async function findUp(context: AgentContext, target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(context, search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(context: AgentContext, options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(context, search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(context: AgentContext, pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const { Glob } = await import("./glob")
        const matches = await Glob.scan(context, pattern, {
          cwd: current,
          absolute: true,
          include: "file",
          dot: true,
        })
        result.push(...matches)
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}

import { lookup } from "mime-types"
import { dirname, join, relative, resolve as pathResolve } from "path"
import { Instance } from "../project/instance"

export namespace Filesystem {
  // ── Read operations (all via Instance.vfs) ──────────────────────────

  export async function exists(p: string): Promise<boolean> {
    return Instance.vfs.exists(p)
  }

  export async function isDir(p: string): Promise<boolean> {
    const s = await Instance.vfs.stat(p)
    return s?.isDirectory ?? false
  }

  export async function stat(p: string) {
    return Instance.vfs.stat(p)
  }

  export async function size(p: string): Promise<number> {
    const s = await Instance.vfs.stat(p)
    return s?.size ?? 0
  }

  export async function readText(p: string): Promise<string> {
    return Instance.vfs.readText(p)
  }

  export async function readJson<T = any>(p: string): Promise<T> {
    return JSON.parse(await readText(p))
  }

  export async function readBytes(p: string): Promise<Uint8Array> {
    return Instance.vfs.readBytes(p)
  }

  export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
    const bytes = await readBytes(p)
    return bytes.buffer as ArrayBuffer
  }

  // ── Write operations (all via Instance.vfs) ─────────────────────────

  export async function write(p: string, content: string | Uint8Array): Promise<void> {
    return Instance.vfs.write(p, content)
  }

  export async function writeJson(p: string, data: unknown): Promise<void> {
    return write(p, JSON.stringify(data, null, 2))
  }

  export async function mkdir(p: string): Promise<void> {
    return Instance.vfs.mkdir(p)
  }

  export async function remove(p: string): Promise<void> {
    return Instance.vfs.remove(p)
  }

  // ── Path utilities (pure, no fs dependency) ─────────────────────────

  export function mimeType(p: string): string {
    return lookup(p) || "application/octet-stream"
  }

  export function resolve(p: string): string {
    return pathResolve(windowsPath(p))
  }

  export function windowsPath(p: string): string {
    if (process.platform !== "win32") return p
    return (
      p
        .replace(/^\/([a-zA-Z]):(?:[\\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
        .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
    )
  }

  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const { Glob } = await import("./glob")
        const matches = await Glob.scan(pattern, {
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

/**
 * Pure JS path utilities — POSIX only, zero Node.js dependencies.
 *
 * Drop-in replacement for the subset of `path` used in opencode.
 */

export const sep = "/"

export function join(...parts: string[]): string {
    const joined = parts
        .filter(Boolean)
        .join("/")
    return normalize(joined)
}

export function dirname(p: string): string {
    if (!p) return "."
    const i = p.lastIndexOf("/")
    if (i < 0) return "."
    if (i === 0) return "/"
    return p.slice(0, i)
}

export function basename(p: string, ext?: string): string {
    if (p.endsWith("/")) p = p.slice(0, -1)
    const i = p.lastIndexOf("/")
    const base = i < 0 ? p : p.slice(i + 1)
    if (ext && base.endsWith(ext)) return base.slice(0, -ext.length)
    return base
}

export function extname(p: string): string {
    const base = basename(p)
    const i = base.lastIndexOf(".")
    if (i <= 0) return ""
    return base.slice(i)
}

export function isAbsolute(p: string): boolean {
    return p.startsWith("/")
}

export function normalize(p: string): string {
    if (!p) return "."
    const isAbs = p.startsWith("/")
    const segments = p.split("/")
    const out: string[] = []
    for (const s of segments) {
        if (s === "" || s === ".") continue
        if (s === "..") {
            if (out.length > 0 && out[out.length - 1] !== "..") {
                out.pop()
            } else if (!isAbs) {
                out.push("..")
            }
        } else {
            out.push(s)
        }
    }
    const result = out.join("/")
    if (isAbs) return "/" + result
    return result || "."
}

export function relative(from: string, to: string): string {
    from = normalize(from)
    to = normalize(to)
    if (from === to) return ""

    const fromParts = from.split("/").filter(Boolean)
    const toParts = to.split("/").filter(Boolean)

    let common = 0
    while (
        common < fromParts.length &&
        common < toParts.length &&
        fromParts[common] === toParts[common]
    ) {
        common++
    }

    const ups = fromParts.length - common
    const downs = toParts.slice(common)
    const parts = [...Array(ups).fill(".."), ...downs]
    return parts.join("/") || "."
}

/** Resolve segments against a base. Unlike Node's path.resolve, this does NOT
 *  read process.cwd() — pass an absolute base explicitly. */
export function resolve(...parts: string[]): string {
    let resolved = ""
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i]
        if (!part) continue
        resolved = resolved ? part + "/" + resolved : part
        if (isAbsolute(part)) break
    }
    return normalize(resolved)
}

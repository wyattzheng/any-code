import path from "path"
import os from "os"
import fs from "fs"
import { execFile, spawn as cpSpawn } from "child_process"

/** Generate unique per-test dataPath so tests don't share state, and create dir */
export function testPaths() {
    const base = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
    const dataPath = path.join(base, "data")
    fs.mkdirSync(dataPath, { recursive: true })
    return dataPath
}

/**
 * Provides the Node.js-specific deps (shell, git, env) needed by CodeAgent.
 * Use: `new CodeAgent({ ...testNodeDeps(), ... })`
 */
export function testNodeDeps() {
    const shellPath = (() => {
        const s = process.env.SHELL
        const BLACKLIST = new Set(["fish", "nu"])
        if (s && !BLACKLIST.has(path.basename(s))) return s
        return process.platform === "darwin" ? "/bin/zsh" : "/bin/sh"
    })()

    return {
        shell: {
            platform: process.platform,
            spawn(command: string, opts: { cwd: string; env: Record<string, string | undefined> }) {
                return cpSpawn(command, {
                    shell: shellPath,
                    cwd: opts.cwd,
                    env: { ...process.env, ...opts.env },
                    stdio: ["ignore", "pipe", "pipe"],
                    detached: true,
                }) as any
            },
            async kill(proc: any, opts?: { exited?: () => boolean }) {
                const pid = proc.pid
                if (!pid || opts?.exited?.()) return
                try {
                    process.kill(-pid, "SIGTERM")
                    await new Promise(r => setTimeout(r, 200))
                    if (!opts?.exited?.()) process.kill(-pid, "SIGKILL")
                } catch {
                    proc.kill("SIGTERM")
                    await new Promise(r => setTimeout(r, 200))
                    if (!opts?.exited?.()) proc.kill("SIGKILL")
                }
            },
        },
        git: {
            async run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
                return new Promise<{ exitCode: number; text(): string; stdout: Uint8Array; stderr: Uint8Array }>((resolve) => {
                    execFile("git", args, {
                        cwd: opts.cwd,
                        env: opts.env ? { ...process.env, ...opts.env } : undefined,
                        maxBuffer: 50 * 1024 * 1024,
                        encoding: "buffer",
                    }, (error: any, stdout: any, stderr: any) => {
                        const stdoutBuf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "")
                        const stderrBuf = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? "")
                        resolve({
                            exitCode: error ? (error as any).code ?? 1 : 0,
                            text: () => stdoutBuf.toString(),
                            stdout: new Uint8Array(stdoutBuf),
                            stderr: new Uint8Array(stderrBuf),
                        })
                    })
                })
            },
        },
    }
}

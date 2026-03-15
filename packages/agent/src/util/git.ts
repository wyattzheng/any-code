/**
 * GitProvider — pluggable git command executor.
 *
 * The interface is intentionally minimal — just `run(args, opts)`.
 * All git subcommands are passed as raw string arguments, preserving
 * the original git CLI semantics without any abstraction layer.
 *
 * Implementations (e.g. NodeGitProvider) live in the host package (agent/).
 */
export interface GitResult {
  exitCode: number
  text(): string
  stdout: Uint8Array
  stderr: Uint8Array
}

export interface GitProvider {
  run(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<GitResult>
}

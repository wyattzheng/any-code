import z from "zod"
import { Tool } from "./tool"
import * as path from "../util/path"
const DESCRIPTION = `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

All commands run in \${directory} by default. Use the \`workdir\` parameter if you need to run a command in a different directory. AVOID using \`cd <directory> && <command>\` patterns - use \`workdir\` instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")
   - Examples of proper quoting:
     - mkdir "/Users/name/My Documents" (correct)
     - mkdir /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds \${maxLines} lines or \${maxBytes} bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use \`head\`, \`tail\`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.

  - Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - AVOID using \`cd <directory> && <command>\`. Use the \`workdir\` parameter to change directories instead.
    <good-example>
    Use workdir="/foo/bar" with command: pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>

# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend. ONLY use --amend when ALL conditions are met:
  (1) User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files that need including
  (2) HEAD commit was created by you in this conversation (verify: git log -1 --format='%an %ae')
  (3) Commit has NOT been pushed to remote (verify: git status shows "Your branch is ahead")
- CRITICAL: If commit FAILED or was REJECTED by hook, NEVER amend - fix the issue and create a NEW commit
- CRITICAL: If you already pushed to remote, NEVER amend unless user explicitly requests it (requires force push)
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc.). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook, fix the issue and create a NEW commit (see amend rules above)

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite or Task tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a GitHub URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request summary
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "\$(cat <<'EOF'
## Summary
<1-3 bullet points>
</example>

Important:
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a GitHub PR: gh api repos/foo/bar/pulls/123/comments
`


import { Flag } from "../util/flag"

import { Truncate } from "./truncation"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000


// ── Simple bash command parser ─────────────────────────────────────────────
// Extracts individual commands from a bash string by splitting on ;, &&, ||, |
// For each command, returns { text, words } where words[0] is the command name.

interface ParsedCommand {
  /** Full command text (trimmed) */
  text: string
  /** Tokenized words (respecting quotes) */
  words: string[]
}

function parseBashCommands(input: string): ParsedCommand[] {
  const results: ParsedCommand[] = []

  // Split on command separators: &&, ||, ;, |, newlines
  // This is intentionally simple — AI-generated commands are well-formed
  const segments = input.split(/\s*(?:&&|\|\||[;|\n])\s*/)

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const words = tokenize(trimmed)
    if (words.length > 0) {
      results.push({ text: trimmed, words })
    }
  }
  return results
}

/** Tokenize a single command string, respecting single/double quotes */
function tokenize(input: string): string[] {
  const words: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false
  let escape = false

  for (const ch of input) {
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === "\\" && !inSingle) {
      escape = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        words.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }
  if (current) words.push(current)
  return words
}

// ── Bash Tool ──────────────────────────────────────────────────────────────

export const BashTool = Tool.define("bash", async (initCtx?: Tool.InitContext) => {

  return {
    description: DESCRIPTION.replaceAll("${directory}", initCtx?.directory || "")
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${initCtx?.directory || ""}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || ctx.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const commands = parseBashCommands(params.command)

      const directories = new Set<string>()
      if (!ctx.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const cmd of commands) {
        if (!cmd.words.length) continue
        const [name, ...args] = cmd.words

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(name)) {
          for (const arg of args) {
            if (arg.startsWith("-") || (name === "chmod" && arg.startsWith("+"))) continue
            const resolved = path.resolve(cwd, arg)
            const log = ctx.log.create({ service: "bash-tool" })
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              if (!ctx.containsPath(resolved)) {
                const dir = (await ctx.fs.isDir(resolved)) ? resolved : path.dirname(resolved)
                directories.add(dir)
              }
            }
          }
        }

        // cd covered by above check
        if (name !== "cd") {
          patterns.add(cmd.text)
          always.add(name + " *")
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const proc = ctx.shell.spawn(params.command, {
        cwd,
        env: {},
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => ctx.shell.kill(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})

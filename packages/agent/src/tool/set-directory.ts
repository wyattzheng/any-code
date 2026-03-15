import z from "zod"
import { Tool } from "./tool"
import { BusEvent } from "../bus"

export namespace SetDirectory {
  /** Event emitted when agent sets the working directory */
  export const Event = BusEvent.define(
    "directory.set",
    z.object({ directory: z.string() }),
  )
}

export const SetWorkingDirectoryTool = Tool.define("set_working_directory", {
  description: `Use this tool to set the working directory for this session. The user will tell you which project or folder they want to work on. The directory must be an absolute path to an existing directory on the file system. After setting the directory, the full development environment (file browser, diff viewer, etc.) will become available.

IMPORTANT: This tool can only be called ONCE per session. Once the working directory is set, it cannot be changed. If a working directory is already set, this tool will return an error.`,
  parameters: z.object({
    directory: z.string().describe("Absolute path to the project directory"),
  }),
  async execute(params, ctx) {
    // Check if directory is already set (non-empty worktree means it was set)
    if (ctx.worktree && ctx.worktree !== "" && ctx.worktree !== "/") {
      return {
        title: "Already set",
        output: `Working directory is already set to "${ctx.worktree}". It can only be set once per session.`,
        metadata: {},
      }
    }

    const dir = params.directory

    // Validate using the agent's VFS
    const stat = await ctx.fs.stat(dir)
    if (!stat || !stat.isDirectory) {
      return {
        title: "Invalid path",
        output: stat
          ? `"${dir}" is not a directory. Please provide a valid directory path.`
          : `Directory "${dir}" does not exist. Please provide a valid absolute path.`,
        metadata: {},
      }
    }

    // Emit bus event — server listens and handles directory change
    ctx.bus.publish(SetDirectory.Event, { directory: dir })

    return {
      title: `Set directory: ${dir}`,
      output: `Working directory set to "${dir}". The session is now configured to work on this project. The full development environment is now available.`,
      metadata: {},
    }
  },
})

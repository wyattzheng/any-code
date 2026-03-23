import z from "zod"
import { Tool } from "./tool"
const DESCRIPTION = `Send input to the shared user terminal, or create/destroy it.

This tool interacts with a single shared terminal (PTY) that is also visible to the user.

## Actions

- **type="create"**: Spawn a new terminal. Fails if one already exists. You must create a terminal before sending input.
- **type="destroy"**: Kill the current terminal. Use this when the terminal is stuck or unresponsive, then create a new one. Fails if no terminal exists.
- **type="input"**: Send text to the terminal. By default, Enter is pressed after the input (pressEnter=true). Set pressEnter=false for partial input or answering prompts like y/n.

## Important
- In most cases, prefer the **bash** tool for running commands. It is faster, captures output directly, and does not require creating/destroying a terminal.
- Use terminal_write/terminal_read when you need a **persistent, stateful shell session**, e.g. running a long-lived dev server for preview, interactive REPL, or commands that depend on prior shell state.

## Usage notes
- The terminal is shared with the user — they can see everything you type and you can see their output.
- Always create a terminal before sending commands.
- If a long-running command is stuck, destroy and recreate the terminal.
- For commands that produce output, use the terminal_read tool after sending input to see the results.
- When answering interactive prompts (e.g. "Continue? [y/n]"), set pressEnter=false if the program reads single characters, or pressEnter=true if it expects a line.
`

export const TerminalWriteTool = Tool.define("terminal_write", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      type: z
        .enum(["input", "create", "destroy"])
        .describe(
          'The type of action. "input" sends text to the terminal. "create" spawns a new terminal (errors if one already exists). "destroy" kills the current terminal (errors if none exists).',
        ),
      content: z
        .string()
        .describe("The text to send to the terminal. Required when type is \"input\".")
        .optional(),
      pressEnter: z
        .boolean()
        .describe("Whether to press Enter after the input. Defaults to true.")
        .optional(),
    }),
    async execute(params, ctx) {
      const terminal = ctx.terminal

      if (params.type === "create") {
        terminal.create()
        return {
          title: "Terminal created",
          metadata: { type: "create" },
          output: "Terminal created successfully.",
        } as any
      }

      if (params.type === "destroy") {
        terminal.destroy()
        return {
          title: "Terminal destroyed",
          metadata: { type: "destroy" },
          output: "Terminal destroyed successfully.",
        } as any
      }

      // input
      if (!params.content) {
        throw new Error("content is required for input")
      }

      if (!terminal.exists()) {
        throw new Error("No terminal exists. Use type \"create\" first.")
      }

      const pressEnter = params.pressEnter ?? true
      const data = pressEnter ? params.content + "\n" : params.content
      terminal.write(data)

      return {
        title: params.content.length > 60 ? params.content.slice(0, 57) + "..." : params.content,
        metadata: {
          type: "input" as const,
          content: params.content,
          pressEnter,
        },
        output: `Input sent to terminal.`,
      } as any
    },
  }
})

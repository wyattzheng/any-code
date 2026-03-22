import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./terminal-write.txt"

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

import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./terminal-read.txt"

export const TerminalReadTool = Tool.define("terminal_read", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      length: z
        .number()
        .int()
        .min(1)
        .describe("Number of lines to read from the bottom of the terminal buffer."),
      waitBefore: z
        .number()
        .int()
        .min(0)
        .describe("Milliseconds to wait before reading. Use this to let a command finish producing output. Defaults to 0.")
        .optional(),
    }),
    async execute(params, ctx) {
      const terminal = ctx.terminal

      if (!terminal.exists()) {
        throw new Error("No terminal exists. Use terminal_write with type \"create\" first.")
      }

      const waitMs = params.waitBefore ?? 0
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }

      const content = terminal.read(params.length)

      return {
        title: `Read ${params.length} lines`,
        metadata: {
          length: params.length,
          waitBefore: waitMs,
        },
        output: content || "(terminal buffer is empty)",
      }
    },
  }
})

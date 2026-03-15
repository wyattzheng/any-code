import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import type { AgentContext } from "@/agent/context"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    ),
  }

  export function update(context: AgentContext, input: { sessionID: SessionID; todos: Info[] }) {
    context.db.transaction((tx: any) => {
      tx.remove("todo", { op: "eq", field: "session_id", value: input.sessionID })
      if (input.todos.length === 0) return
      for (const [position, todo] of input.todos.entries()) {
        tx.insert("todo", {
          session_id: input.sessionID,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          position,
        })
      }
    })
    Bus.publish(context, Event.Updated, input)
  }

  export function get(context: AgentContext, sessionID: SessionID) {
    const rows = context.db.findMany("todo", {
      filter: { op: "eq", field: "session_id", value: sessionID },
      orderBy: [{ field: "position", direction: "asc" }],
    })
    return rows.map((row: any) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
  }
}

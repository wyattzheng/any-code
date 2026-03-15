import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"
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
      tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      tx.insert(TodoTable)
        .values(
          input.todos.map((todo: Info, position: number) => ({
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
          })),
        )
        .run()
    })
    Bus.publish(context, Event.Updated, input)
  }

  export function get(context: AgentContext, sessionID: SessionID) {
    const rows = context.db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all()
    return rows.map((row: any) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
  }
}

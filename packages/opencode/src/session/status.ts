import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import type { AgentContext } from "@/agent/context"
import { SessionID } from "./schema"
import z from "zod"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  /**
   * SessionStatusService — tracks per-session busy/idle/retry status.
   */
  export class SessionStatusService {
    private statuses: Record<string, Info> = {}

    constructor(private context?: AgentContext) {}

    get(sessionID: SessionID): Info {
      return this.statuses[sessionID] ?? { type: "idle" }
    }

    list(): Record<string, Info> {
      return this.statuses
    }

    set(sessionID: SessionID, status: Info): void {
      if (this.context) {
        Bus.publish(this.context, Event.Status, { sessionID, status })
      }
      if (status.type === "idle") {
        if (this.context) {
          Bus.publish(this.context, Event.Idle, { sessionID })
        }
        delete this.statuses[sessionID]
        return
      }
      this.statuses[sessionID] = status
    }
  }


  /** @deprecated */ export function get(context: AgentContext, sessionID: SessionID) {
    return context.sessionStatus.get(sessionID)
  }

  /** @deprecated */ export function list(context: AgentContext) {
    return context.sessionStatus.list()
  }

  /** @deprecated */ export function set(context: AgentContext, sessionID: SessionID, status: Info) {
    context.sessionStatus.set(sessionID, status)
  }
}

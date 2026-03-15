import type { AgentContext } from "@/agent/context"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"


const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  async function currentBranch(context: AgentContext) {
    const result = await context.git.run(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: context.worktree,
    })
    if (result.exitCode !== 0) return
    const text = result.text().trim()
    if (!text) return
    return text
  }

  /**
   * VcsService — tracks current VCS branch and watches for changes.
   */
  export class VcsService {
    branch: string | undefined = undefined
    unsub: (() => void) | undefined = undefined

    constructor(context: AgentContext) {
      // async init - fire and forget
      ;(async () => {
        if (context.project.vcs !== "git") return
        this.branch = await currentBranch(context)
        log.info("initialized", { branch: this.branch })

        this.unsub = Bus.subscribe(context, FileWatcher.Event.Updated, async (evt) => {
          if (evt.properties.file.endsWith("HEAD")) return
          const next = await currentBranch(context)
          if (next !== this.branch) {
            log.info("branch changed", { from: this.branch, to: next })
            this.branch = next
            Bus.publish(context, Event.BranchUpdated, { branch: next })
          }
        })
      })()
    }
  }
}

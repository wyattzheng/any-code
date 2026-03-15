import type { AgentContext } from "@/agent/context"
import { Plugin } from "../util/plugin"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Log } from "@/util/log"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"

export async function InstanceBootstrap(context: AgentContext) {
  Log.Default.info("bootstrapping", { directory: context.directory })
  await Plugin.init()
  // FileWatcherService and VcsService initialize themselves in their constructors
  Snapshot.init(context)
  Truncate.init(context)

  Bus.subscribe(context, Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(context.project.id)
    }
  })
}

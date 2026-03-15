import type { AgentContext } from "@/agent/context"
import { Plugin } from "../util/plugin"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Log } from "@/util/log"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"

export async function InstanceBootstrap(context: AgentContext) {
  Log.Default.info("bootstrapping", { directory: context.directory })
  await Plugin.init()
  FileWatcher.init(context)
  // File service initialized via CodeAgent
  // VcsService initializes itself in constructor (created in CodeAgent.init())
  Snapshot.init(context)
  Truncate.init(context)

  Bus.subscribe(context, Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(context.project.id)
    }
  })
}

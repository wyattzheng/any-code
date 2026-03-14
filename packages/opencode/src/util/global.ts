import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    // Allow override via OPENCODE_TEST_HOME for test isolation
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }

  /**
   * Initialize global directories and cache.
   * Must be called during bootstrap, not at import time.
   */
  export async function init() {
    const fs = await import("fs/promises")
    await Promise.all([
      fs.mkdir(Path.data, { recursive: true }),
      fs.mkdir(Path.config, { recursive: true }),
      fs.mkdir(Path.state, { recursive: true }),
      fs.mkdir(Path.log, { recursive: true }),
      fs.mkdir(Path.bin, { recursive: true }),
    ])

    const CACHE_VERSION = "21"
    const versionFile = path.join(Path.cache, "version")
    const version = await fs.readFile(versionFile, "utf-8").catch(() => "0")

    if (version !== CACHE_VERSION) {
      try {
        const contents = await fs.readdir(Path.cache)
        await Promise.all(
          contents.map((item) =>
            fs.rm(path.join(Path.cache, item), {
              recursive: true,
              force: true,
            }),
          ),
        )
      } catch (e) {}
      await fs.mkdir(path.dirname(versionFile), { recursive: true })
      await fs.writeFile(versionFile, CACHE_VERSION)
    }
  }
}

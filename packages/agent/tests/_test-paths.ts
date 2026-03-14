import path from "path"
import os from "os"
import fs from "fs"

/** Generate unique per-test paths so tests don't share state, and create dirs */
export function testPaths(testName?: string) {
    const base = path.join(os.tmpdir(), "opencode-test", testName ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const paths = {
        data: path.join(base, "data"),
        bin: path.join(base, "bin"),
        log: path.join(base, "log"),
        cache: path.join(base, "cache"),
        config: path.join(base, "config"),
        state: path.join(base, "state"),
        home: os.homedir(),
    }
    // Create all directories
    for (const dir of Object.values(paths)) {
        if (dir !== os.homedir()) {
            fs.mkdirSync(dir, { recursive: true })
        }
    }
    return paths
}

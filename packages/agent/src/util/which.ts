import whichPkg from "which"

export function which(cmd: string, env?: Record<string, string | undefined>) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env?.PATH ?? env?.Path,
    pathExt: env?.PATHEXT ?? env?.PathExt,
  })
  return typeof result === "string" ? result : null
}

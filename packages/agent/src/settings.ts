/**
 * Settings — type definitions for ~/.anycode/settings.json
 *
 * The actual file loading is done by the host (server, CLI, etc.).
 * Agent only consumes the typed object via CodeAgentOptions.settings.
 */

export namespace Settings {
  export interface Info {
    hooks?: import("./hooks").Hooks.HooksConfig
    env?: Record<string, string>
    [key: string]: any
  }
}

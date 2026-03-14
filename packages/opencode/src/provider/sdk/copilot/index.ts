/**
 * GitHub Copilot SDK stub — original 25-file SDK removed (auth/OAuth removed).
 * Copilot requires OAuth authentication which is not supported in agent mode.
 * This stub prevents import errors while making the provider unavailable.
 */
export function createOpenaiCompatible(..._args: any[]): any {
  throw new Error("GitHub Copilot provider is not available in agent mode (requires OAuth)")
}

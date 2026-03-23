/**
 * Logger — minimal logging interface.
 *
 * Consumers inject their own logger (e.g. from @any-code/agent's Log system).
 * When no logger is provided, falls back to console.
 */

export interface Logger {
    debug(message: string, ...args: any[]): void
    info(message: string, ...args: any[]): void
    warn(message: string, ...args: any[]): void
    error(message: string, ...args: any[]): void
}

/** Default logger backed by console. */
export const consoleLogger: Logger = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
}

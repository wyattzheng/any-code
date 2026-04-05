export const API_ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  SETTINGS_ACCOUNT_INCOMPLETE: "SETTINGS_ACCOUNT_INCOMPLETE",
  SETTINGS_ACCOUNT_NAME_DUPLICATE: "SETTINGS_ACCOUNT_NAME_DUPLICATE",
  OAUTH_PROVIDER_UNSUPPORTED: "OAUTH_PROVIDER_UNSUPPORTED",
  OAUTH_SESSION_NOT_FOUND: "OAUTH_SESSION_NOT_FOUND",
  OAUTH_SESSION_EXPIRED: "OAUTH_SESSION_EXPIRED",
  OAUTH_TOKEN_EXCHANGE_FAILED: "OAUTH_TOKEN_EXCHANGE_FAILED",
} as const

export function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined
}

export function createApiError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string }
  error.code = code
  return error
}

import fs from "fs"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"

export const ANYCODE_DIR_NAME = ".anycode"
export const SETTINGS_FILE_NAME = "settings.json"
export const DEFAULT_AGENT = "anycode"
export const DEFAULT_PROVIDER = "anthropic"
export const DEFAULT_MODEL = "claude-sonnet-4-20250514"

export interface AccountSettings {
  id: string
  name: string
  AGENT: string
  PROVIDER: string
  MODEL: string
  API_KEY: string
  BASE_URL?: string
}

export interface UserSettingsFile extends Record<string, any> {
  accounts?: AccountSettings[]
  currentAccountId?: string | null
  MODEL?: string
  TLS_CERT?: string
  TLS_KEY?: string
  AGENT?: string
  PROVIDER?: string
  API_KEY?: string
  BASE_URL?: string
}

export interface RuntimeSettings {
  agent: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  currentAccount: AccountSettings | null
  userSettings: UserSettingsFile
}

export interface SettingsStoreOptions {
  homeDir?: string
  anycodeDir?: string
  settingsPath?: string
}

export function normalizeString(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function createAccountId() {
  return randomUUID()
}

function cloneAccount(account: AccountSettings | null | undefined) {
  return account ? { ...account } : null
}

function cloneSettings(settings: UserSettingsFile): UserSettingsFile {
  return {
    ...settings,
    accounts: Array.isArray(settings.accounts) ? settings.accounts.map((account) => ({ ...account })) : [],
  }
}

export function accountDisplayName(input: Partial<AccountSettings>, index: number) {
  const explicit = normalizeString(input.name)
  if (explicit) return explicit
  const parts = [normalizeString(input.PROVIDER), normalizeString(input.AGENT)].filter(Boolean)
  if (parts.length > 0) return parts.join(" / ")
  return `账号 ${index + 1}`
}

export function normalizeAccount(input: Partial<AccountSettings>, index: number, fallbackModel = DEFAULT_MODEL): AccountSettings {
  const id = normalizeString(input.id) ?? createAccountId()
  const AGENT = normalizeString(input.AGENT) ?? DEFAULT_AGENT
  const PROVIDER = normalizeString(input.PROVIDER) ?? DEFAULT_PROVIDER
  const MODEL = normalizeString(input.MODEL) ?? fallbackModel
  const API_KEY = normalizeString(input.API_KEY) ?? ""
  const BASE_URL = normalizeString(input.BASE_URL)
  const normalized: AccountSettings = {
    id,
    name: accountDisplayName(input, index),
    AGENT,
    PROVIDER,
    MODEL,
    API_KEY,
  }
  if (BASE_URL) normalized.BASE_URL = BASE_URL
  return normalized
}

function hasLegacyAccountConfig(raw: UserSettingsFile) {
  return Boolean(
    normalizeString(raw.AGENT) ||
    normalizeString(raw.PROVIDER) ||
    normalizeString(raw.API_KEY) ||
    normalizeString(raw.BASE_URL),
  )
}

export function normalizeSettings(raw: unknown): UserSettingsFile {
  const base = raw && typeof raw === "object" ? { ...(raw as Record<string, any>) } : {}
  const input = base as UserSettingsFile
  const legacyModel = normalizeString(input.MODEL) ?? DEFAULT_MODEL

  let accounts = Array.isArray(input.accounts)
    ? input.accounts
      .filter((item) => Boolean(item) && typeof item === "object")
      .map((item, index) => normalizeAccount(item as Partial<AccountSettings>, index, legacyModel))
    : []

  if (accounts.length === 0 && hasLegacyAccountConfig(input)) {
    accounts = [normalizeAccount({
      id: "default",
      name: "默认账号",
      AGENT: input.AGENT,
      PROVIDER: input.PROVIDER,
      MODEL: input.MODEL,
      API_KEY: input.API_KEY,
      BASE_URL: input.BASE_URL,
    }, 0, legacyModel)]
  }

  const seenIds = new Set<string>()
  accounts = accounts.map((account, index) => {
    let id = account.id
    while (seenIds.has(id)) id = createAccountId()
    seenIds.add(id)
    return {
      ...account,
      id,
      name: normalizeString(account.name) ?? accountDisplayName(account, index),
    }
  })

  const hasExplicitCurrentAccount = Object.prototype.hasOwnProperty.call(input, "currentAccountId")
  const currentAccountId = typeof input.currentAccountId === "string" && accounts.some((account) => account.id === input.currentAccountId)
    ? input.currentAccountId
    : hasExplicitCurrentAccount
      ? null
      : (accounts[0]?.id ?? null)

  const normalized: UserSettingsFile = {
    ...input,
    accounts,
    currentAccountId,
  }
  delete normalized.AGENT
  delete normalized.PROVIDER
  delete normalized.API_KEY
  delete normalized.BASE_URL
  delete normalized.MODEL
  return normalized
}

export class SettingsModel {
  private data: UserSettingsFile

  constructor(raw: unknown = {}) {
    this.data = normalizeSettings(raw)
  }

  static from(raw: unknown = {}) {
    return new SettingsModel(raw)
  }

  toJSON(): UserSettingsFile {
    return cloneSettings(this.data)
  }

  get accounts(): AccountSettings[] {
    return (this.data.accounts ?? []).map((account) => ({ ...account }))
  }

  get currentAccountId(): string | null {
    return this.data.currentAccountId ?? null
  }

  getCurrentAccount(): AccountSettings | null {
    const accounts = this.data.accounts ?? []
    if (accounts.length === 0) return null
    if (typeof this.data.currentAccountId === "string") {
      return cloneAccount(accounts.find((account) => account.id === this.data.currentAccountId) ?? null)
    }
    return null
  }

  resolveRuntime(): RuntimeSettings {
    const currentAccount = this.getCurrentAccount()
    return {
      agent: normalizeString(currentAccount?.AGENT) ?? DEFAULT_AGENT,
      provider: normalizeString(currentAccount?.PROVIDER) ?? DEFAULT_PROVIDER,
      model: normalizeString(currentAccount?.MODEL) ?? DEFAULT_MODEL,
      apiKey: normalizeString(currentAccount?.API_KEY) ?? "",
      baseUrl: normalizeString(currentAccount?.BASE_URL) ?? "",
      currentAccount,
      userSettings: this.toJSON(),
    }
  }

  update(patch: Partial<UserSettingsFile>) {
    this.data = normalizeSettings({ ...this.data, ...patch })
    return this
  }

  replaceAccounts(accounts: Partial<AccountSettings>[], currentAccountId: string | null = this.currentAccountId) {
    this.data = normalizeSettings({
      ...this.data,
      accounts,
      currentAccountId,
    })
    return this
  }

  setCurrentAccountId(currentAccountId: string | null) {
    this.data = normalizeSettings({
      ...this.data,
      currentAccountId,
    })
    return this
  }
}

export class SettingsStore {
  readonly anycodeDir: string
  readonly path: string

  constructor(options: SettingsStoreOptions = {}) {
    this.anycodeDir = options.anycodeDir ?? path.join(options.homeDir ?? os.homedir(), ANYCODE_DIR_NAME)
    this.path = options.settingsPath ?? path.join(this.anycodeDir, SETTINGS_FILE_NAME)
  }

  read() {
    try {
      fs.mkdirSync(this.anycodeDir, { recursive: true })
      return new SettingsModel(JSON.parse(fs.readFileSync(this.path, "utf-8")))
    } catch {
      return new SettingsModel({})
    }
  }

  write(input: SettingsModel | UserSettingsFile | unknown) {
    const model = input instanceof SettingsModel ? new SettingsModel(input.toJSON()) : new SettingsModel(input)
    fs.mkdirSync(this.anycodeDir, { recursive: true })
    fs.writeFileSync(this.path, JSON.stringify(model.toJSON(), null, 2) + "\n")
    return model
  }
}

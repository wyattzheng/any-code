import type { Brand } from "../util/schema"
import { Identifier } from "../util/id"

export type SessionID = Brand<string, "SessionID">

export const SessionID = {
  make: (id: string) => id as SessionID,
  descending: (id?: string) => Identifier.descending("session", id) as SessionID,
}

export type MessageID = Brand<string, "MessageID">

export const MessageID = {
  make: (id: string) => id as MessageID,
  ascending: (id?: string) => Identifier.ascending("message", id) as MessageID,
}

export type PartID = Brand<string, "PartID">

export const PartID = {
  make: (id: string) => id as PartID,
  ascending: (id?: string) => Identifier.ascending("part", id) as PartID,
}

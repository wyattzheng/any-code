import type { Brand } from "../util/schema"
import { Identifier } from "../util/id"

export type ToolID = Brand<string, "ToolID">

export const ToolID = {
  make: (id: string) => id as ToolID,
  ascending: (id?: string) => Identifier.ascending("tool", id) as ToolID,
}

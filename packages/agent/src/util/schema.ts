/**
 * Branded type utility — creates a nominal type from a base type.
 *
 * @example
 *   type UserID = Brand<string, "UserID">
 *   const make = (id: string) => id as UserID
 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

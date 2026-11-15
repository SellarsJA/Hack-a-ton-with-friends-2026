import { neon } from '@neondatabase/serverless'

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

let singleton: Db | undefined

/** Lazily created Neon-backed Db. Throws if DATABASE_URL is unset when first used. */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const sql = neon(url)
    singleton = {
      async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
        return (await sql.query(text, params ?? [])) as T[]
      },
    }
  }
  return singleton
}

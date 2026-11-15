import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const sql = postgres(url, { onnotice: () => {} })
try {
  await sql.unsafe(readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8'))
  console.log('Applied db/schema.sql')
} finally {
  await sql.end()
}

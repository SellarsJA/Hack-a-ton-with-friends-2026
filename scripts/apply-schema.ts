import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { onnotice: () => {} })
  try {
    await sql.unsafe(readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8'))
    console.log('Applied db/schema.sql')
  } finally {
    await sql.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

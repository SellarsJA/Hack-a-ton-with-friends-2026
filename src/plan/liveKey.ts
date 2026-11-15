import { z } from 'zod'
import type { Candidate } from '@/src/plan/query'

export type LiveKeyLeg = {
  t: string // tripId
  d: string // serviceDate
  bs: string
  bq: number
  bt: number // scheduled departure, GTFS seconds
  as: string
  aq: number
  at: number // scheduled arrival, GTFS seconds
  r: string // routeId
  rail: boolean
}

export type LiveKeyPayload = { legs: LiveKeyLeg[]; tw: number | null }

const Leg = z.object({
  t: z.string(),
  d: z.string(),
  bs: z.string(),
  bq: z.number().int(),
  bt: z.number(),
  as: z.string(),
  aq: z.number().int(),
  at: z.number(),
  r: z.string(),
  rail: z.boolean(),
})
const Payload = z.object({ legs: z.array(Leg).min(1).max(2), tw: z.number().nullable() })

export function encodeLiveKey(p: LiveKeyPayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64url')
}

export function decodeLiveKey(s: string): LiveKeyPayload | null {
  try {
    const parsed = Payload.safeParse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function liveKeyFor(c: Candidate): LiveKeyLeg {
  return {
    t: c.tripId,
    d: c.serviceDate,
    bs: c.board.stopId,
    bq: c.board.seq,
    bt: c.board.dep,
    as: c.alight.stopId,
    aq: c.alight.seq,
    at: c.alight.arr,
    r: c.routeId,
    rail: c.routeType === 0 || c.routeType === 1,
  }
}

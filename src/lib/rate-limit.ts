import { NextResponse } from 'next/server'

/**
 * Per-user sliding-window rate limiter for the AI endpoints.
 *
 * Protects the shared free-tier AI quota from a single user (or a stuck
 * client) burning it for everyone. State lives in memory of each warm server
 * instance — enough to stop accidental or casual abuse on a single-region
 * deployment. For multi-region / high-traffic production, swap the Map for a
 * shared store (e.g. Upstash Redis) behind the same function signature.
 */

type Rule = { limit: number; windowMs: number }

export const AI_LIMITS = {
  chat: { limit: 20, windowMs: 60_000 }, // 20 messages / minute
  diagnose: { limit: 10, windowMs: 10 * 60_000 }, // 10 diagnoses / 10 minutes
  tasks: { limit: 10, windowMs: 10 * 60_000 }, // 10 task generations / 10 minutes
  communityAi: { limit: 5, windowMs: 10 * 60_000 }, // 5 AI forum replies / 10 minutes
} satisfies Record<string, Rule>

const hits = new Map<string, number[]>()
let lastSweep = Date.now()

export function checkRateLimit(bucket: keyof typeof AI_LIMITS, userId: string): { ok: boolean; retryAfterSec: number } {
  const { limit, windowMs } = AI_LIMITS[bucket]
  const now = Date.now()
  const key = `${bucket}:${userId}`
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)

  if (recent.length >= limit) {
    hits.set(key, recent)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) }
  }
  recent.push(now)
  hits.set(key, recent)

  // Occasionally drop idle keys so memory stays bounded.
  if (now - lastSweep > 10 * 60_000) {
    lastSweep = now
    hits.forEach((times, k) => {
      if (!times.length || now - times[times.length - 1] > 10 * 60_000) hits.delete(k)
    })
  }
  return { ok: true, retryAfterSec: 0 }
}

/** Returns a 429 response if the user is over the limit, otherwise null. */
export function rateLimitResponse(bucket: keyof typeof AI_LIMITS, userId: string): NextResponse | null {
  const { ok, retryAfterSec } = checkRateLimit(bucket, userId)
  if (ok) return null
  return NextResponse.json(
    { error: `Too many requests. Please wait ${retryAfterSec} seconds and try again.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { aiGenerate, AiChainError, getChainHealth, getRecentRequests, stepKey, TEXT_CHAIN, VISION_CHAIN } from '@/lib/ai'
import { rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

// GET /api/ai/status — health of every model in both fallback chains + recent requests.
export async function GET() {
  const { user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    chains: { text: getChainHealth(TEXT_CHAIN), vision: getChainHealth(VISION_CHAIN) },
    recent: getRecentRequests(),
    serverTime: new Date().toISOString(),
  })
}

// POST /api/ai/status  { simulate?: 0-3 }
// Sends a tiny prompt through the TEXT chain. `simulate` makes the first N models
// fail with a simulated outage (no network call, no effect on real health), so the
// automatic failover can be demonstrated live.
export async function POST(req: NextRequest) {
  const { user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = rateLimitResponse('chat', user.id)
  if (limited) return limited

  const body = (await req.json().catch(() => ({}))) as { simulate?: unknown }
  const simulate = Math.max(0, Math.min(TEXT_CHAIN.length - 1, Math.floor(Number(body.simulate) || 0)))
  const simulateFailures = new Set(TEXT_CHAIN.slice(0, simulate).map(stepKey))

  try {
    const r = await aiGenerate(
      { messages: [{ role: 'user', content: 'Reply with one short sentence confirming you are online and ready to help Indian farmers.' }] },
      { label: simulate ? `live-test (simulated ${simulate} outage${simulate > 1 ? 's' : ''})` : 'live-test', maxTokens: 60, temperature: 0.3, simulateFailures, attemptTimeoutMs: 20_000 }
    )
    return NextResponse.json({ ok: true, text: r.text, model: r.model, provider: r.provider, latencyMs: r.latencyMs, attempts: r.attempts, simulated: simulate })
  } catch (err) {
    if (err instanceof AiChainError) {
      return NextResponse.json({ ok: false, attempts: err.attempts, simulated: simulate, error: 'All AI providers failed' })
    }
    console.error('[/api/ai/status]', err)
    return NextResponse.json({ error: 'Live test failed to run.' }, { status: 500 })
  }
}

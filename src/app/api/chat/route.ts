import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { aiStream, AiChainError } from '@/lib/ai'
import { rateLimitResponse } from '@/lib/rate-limit'
import { formatDate } from '@/lib/format'
import type { SupabaseClient } from '@supabase/supabase-js'

// Allow enough time for the fallback chain (OpenRouter → Gemini) plus streaming.
export const maxDuration = 60

const HISTORY_LIMIT = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Build dynamic system prompt from user context ─────────────────────────────
async function buildSystemPrompt(supabase: SupabaseClient, userId: string): Promise<string> {
  // Independent lookups run in parallel.
  const [{ data: profile }, { data: farms }, { data: lastDiag }] = await Promise.all([
    supabase.from('users').select('full_name, district, state, preferred_language').eq('id', userId).maybeSingle(),
    supabase
      .from('farms')
      .select('name, total_area_acres, soil_type, water_source, crop_cycles(crop_name, variety, growth_stage, status)')
      .eq('user_id', userId)
      .limit(5),
    supabase
      .from('diagnoses')
      .select('crop_type, disease_name, severity, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const farmerName = profile?.full_name ?? 'Farmer'
  const location = [profile?.district, profile?.state].filter(Boolean).join(', ') || 'India'
  const language = profile?.preferred_language ?? 'English'

  const cropContext =
    farms
      ?.flatMap((f) =>
        ((f.crop_cycles as { crop_name: string; variety: string | null; growth_stage: string; status: string }[]) ?? [])
          .filter((c) => c.status === 'active')
          .map((c) => `${c.crop_name}${c.variety ? ` (${c.variety})` : ''} — ${c.growth_stage} stage on ${f.name}`)
      )
      .join('\n  ') || 'No active crops recorded'

  const farmContext =
    farms
      ?.map((f) => `• ${f.name}: ${f.total_area_acres ?? '?'} acres, Soil: ${f.soil_type ?? 'unknown'}, Water: ${f.water_source ?? 'unknown'}`)
      .join('\n') || 'No farms registered'

  const diagContext = lastDiag
    ? `${lastDiag.disease_name ?? 'Unknown'} on ${lastDiag.crop_type} (${lastDiag.severity} severity, ${formatDate(lastDiag.created_at)})`
    : 'No recent diagnoses'

  return `You are AgriDoctor, an expert agricultural advisor for Indian farming.

## Farmer Profile
- Name: ${farmerName}
- Location: ${location}
- Preferred language: ${language}

## Farm Overview
${farmContext}

## Active Crops
  ${cropContext}

## Latest Disease Detection
${diagContext}

## Instructions
- Respond primarily in ${language}. Match the language the farmer uses.
- Give practical, specific advice. Reference their actual crop data.
- When recommending chemicals, always include dosage, frequency, and timing.
- Flag urgent situations clearly (e.g., "⚠️ Act within 48 hours").
- Be warm, concise, and use bullet points for lists.`
}

export async function POST(req: NextRequest) {
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limited = rateLimitResponse('chat', user.id)
    if (limited) return limited

    const { message, sessionId } = (await req.json().catch(() => ({}))) as { message?: unknown; sessionId?: unknown }
    if (typeof message !== 'string' || !message.trim() || typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'message and sessionId required' }, { status: 400 })
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: 'Message too long (max 4000 characters)' }, { status: 400 })
    }

    // Session ownership check, recent history and personalised prompt — all in parallel.
    const [{ data: session }, { data: recent }, systemPrompt] = await Promise.all([
      supabase.from('chat_sessions').select('id, title').eq('id', sessionId).eq('user_id', user.id).maybeSingle(),
      // Newest N messages (then reversed below), so long conversations keep their RECENT context.
      supabase
        .from('chat_messages')
        .select('role, content')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
      buildSystemPrompt(supabase, user.id),
    ])

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const history = (recent ?? [])
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))

    const writes: PromiseLike<unknown>[] = [
      supabase.from('chat_messages').insert({ session_id: sessionId, role: 'user', content: message }),
    ]
    if (session.title === 'New Conversation') {
      const title = message.length > 60 ? message.slice(0, 60) + '…' : message
      writes.push(supabase.from('chat_sessions').update({ title }).eq('id', sessionId))
    }

    const [ai] = await Promise.all([
      aiStream(
        { system: systemPrompt, messages: [...history, { role: 'user', content: message }] },
        { label: 'chat', maxTokens: 1000, temperature: 0.7 }
      ),
      ...writes,
    ])

    // Persist the assistant reply once the stream finishes (or the client disconnects).
    const persisted = ai.done.then(async ({ text }) => {
      if (text.trim()) {
        await supabase.from('chat_messages').insert({ session_id: sessionId, role: 'assistant', content: text, model: ai.model })
      }
    })

    // Hold the stream open until the reply is saved, so serverless runtimes don't freeze before the write.
    const reader = ai.stream.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          await persisted.catch((e) => console.error('[/api/chat] save failed:', e))
          controller.close()
        } else {
          controller.enqueue(value)
        }
      },
      cancel(reason) {
        void reader.cancel(reason)
      },
    })

    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-AI-Provider': ai.provider,
        'X-AI-Model': ai.model,
      },
    })
  } catch (err: unknown) {
    if (err instanceof AiChainError) {
      return NextResponse.json(
        { error: 'All AI providers are busy right now. Please try again in a minute.', attempts: err.attempts.length },
        { status: 503 }
      )
    }
    // Log the detail server-side; never leak internals to the browser.
    console.error('[/api/chat]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { aiText } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { getAdminClient } from '@/lib/supabase/admin'

const MAX_AI_REPLIES_PER_POST = 3

// AI fallback chain may try several models; allow time for it.
export const maxDuration = 60

async function generateAiReply(title: string, body: string, tags: string[]): Promise<string | null> {
  try {
    return await aiText(
      [
        {
          role: 'system',
          content:
            'You are AgriDoctor AI, a concise agronomy assistant for Indian smallholder farmers. ' +
            'Reply to a farmer community question in 4-7 short bullet points with practical, locally relevant advice. ' +
            'Use plain language, mention common causes and 2-3 concrete next steps. No disclaimers.',
        },
        {
          role: 'user',
          content: `Title: ${title}\nTags: ${tags.join(', ') || 'none'}\n\n${body}`,
        },
      ],
      { maxTokens: 500, temperature: 0.4 }
    )
  } catch (err) {
    console.error('[community/ai] generation failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { content, request_ai } = await req.json()
    if (!content || String(content).trim().length === 0) {
      return NextResponse.json({ error: 'Content required' }, { status: 400 })
    }

    const { data: reply, error } = await supabase
      .from('community_replies')
      .insert({
        post_id: params.id,
        user_id: user.id,
        is_ai: false,
        content: String(content).slice(0, 4000),
      })
      .select()
      .single()

    if (error) {
      console.error('[community/replies] insert failed:', error.message)
      return NextResponse.json({ error: 'Could not post reply. Please try again.' }, { status: 500 })
    }

    // Optionally add an AI reply. Guarded so nobody can burn the shared AI quota:
    // per-user rate limit + at most MAX_AI_REPLIES_PER_POST AI replies on any post.
    let aiSkipped: string | undefined
    if (request_ai === true) {
      const [{ data: post }, { count: aiCount }] = await Promise.all([
        supabase.from('community_posts').select('title,body,tags').eq('id', params.id).maybeSingle(),
        supabase.from('community_replies').select('id', { count: 'exact', head: true }).eq('post_id', params.id).eq('is_ai', true),
      ])
      // AI replies are written with the server-only service-role client: the database blocks
      // ordinary users from creating is_ai replies, so "AgriDoctor AI" answers can't be forged.
      const admin = getAdminClient()
      if (!admin) {
        console.warn('[community/ai] SUPABASE_SERVICE_ROLE_KEY not set — AI replies disabled')
        aiSkipped = 'AI replies are not configured on this server.'
      } else if ((aiCount ?? 0) >= MAX_AI_REPLIES_PER_POST) aiSkipped = 'AI has already answered this post.'
      else if (!checkRateLimit('communityAi', user.id).ok) aiSkipped = 'AI reply limit reached — please try again in a few minutes.'
      else if (post) {
        const aiContent = await generateAiReply(post.title, post.body, post.tags || [])
        if (aiContent) {
          const { error: aiErr } = await admin
            .from('community_replies')
            .insert({ post_id: params.id, user_id: null, is_ai: true, content: aiContent })
          if (aiErr) console.error('[community/ai] insert failed:', aiErr.message)
        } else aiSkipped = 'AI is busy right now — please try again later.'
      }
    }

    return NextResponse.json({ reply, ...(aiSkipped ? { ai_skipped: aiSkipped } : {}) }, { status: 201 })
  } catch (err: unknown) {
    console.error('[community/replies]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not post reply. Please try again.' }, { status: 500 })
  }
}

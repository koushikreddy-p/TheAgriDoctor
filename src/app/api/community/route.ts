import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const tag = searchParams.get('tag')?.trim()

  let query = supabase
    .from('community_posts')
    .select('id,title,body,crop_tag,tags,image_urls,upvotes,created_at,user_id,author_name')
    .order('created_at', { ascending: false })
    .limit(100)

  // Strip characters that have meaning in PostgREST filter syntax, so search text can't add conditions.
  const safeQ = q?.replace(/[,()%*\\:."']/g, ' ').trim().slice(0, 100)
  if (safeQ) query = query.or(`title.ilike.%${safeQ}%,body.ilike.%${safeQ}%`)
  if (tag) query = query.contains('tags', [tag])

  const { data, error } = await query
  if (error) {
    console.error('[community GET]', error.message)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }

  // Fetch reply counts
  const ids = (data ?? []).map((p) => p.id)
  const counts: Record<string, number> = {}
  if (ids.length) {
    const { data: replies } = await supabase
      .from('community_replies')
      .select('post_id')
      .in('post_id', ids)
    for (const r of replies ?? []) counts[r.post_id] = (counts[r.post_id] ?? 0) + 1
  }

  return NextResponse.json({
    posts: (data ?? []).map((p) => ({
      ...p,
      author_name: p.author_name || 'Farmer',
      reply_count: counts[p.id] ?? 0,
    })),
  })
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { title, body: content, crop_tag, tags, image_urls } = body ?? {}
    if (!title || !content) {
      return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        user_id: user.id,
        title: String(title).slice(0, 200),
        body: String(content).slice(0, 5000),
        crop_tag: typeof crop_tag === 'string' ? crop_tag.slice(0, 50) : null,
        tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.slice(0, 40)).slice(0, 10) : [],
        image_urls: Array.isArray(image_urls) ? image_urls.filter((u: unknown) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 6) : [],
      })
      .select()
      .single()

    if (error) {
      console.error('[community POST]', error.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    return NextResponse.json({ post: data }, { status: 201 })
  } catch (err: unknown) {
    console.error('[community POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'

// GET /api/farms/:id/satellite?kind=ndvi|truecolor|falsecolor|evi&palette=1
// Streams the latest satellite image of the farm from Agro Monitoring, adding the
// API key on the server so it is never exposed to the browser.
const KINDS = new Set(['ndvi', 'truecolor', 'falsecolor', 'evi'])
const AGRO_HOST = 'api.agromonitoring.com'

export async function GET(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const { id } = await paramsPromise
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.AGRO_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  const palette = req.nextUrl.searchParams.get('palette')
  if (!KINDS.has(kind) || (palette !== null && !/^\d{1,2}$/.test(palette))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Only the owner's farm, and only the image URL Agro itself returned in the last scan.
  const { data: farm } = await supabase
    .from('farms')
    .select('latest_monitor_snapshot')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  const images = (farm?.latest_monitor_snapshot as { ndvi?: { image?: { image?: Record<string, string> } } } | null)?.ndvi?.image?.image
  const raw = images?.[kind]
  if (!raw) return NextResponse.json({ error: 'No image' }, { status: 404 })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return NextResponse.json({ error: 'No image' }, { status: 404 })
  }
  // SSRF guard: never fetch anything except Agro Monitoring over HTTPS.
  if (target.hostname !== AGRO_HOST) return NextResponse.json({ error: 'No image' }, { status: 404 })
  target.protocol = 'https:'
  target.searchParams.set('appid', apiKey)
  if (palette) target.searchParams.set('paletteid', palette)

  const upstream = await fetch(target, { next: { revalidate: 3600 } }).catch(() => null)
  if (!upstream?.ok || !upstream.body) return new NextResponse(null, { status: 502 })

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

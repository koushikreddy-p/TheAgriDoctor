import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'

// GET /api/weather/tiles/:layer/:z/:x/:y
// Server-side proxy for OpenWeatherMap map tiles, so the API key never reaches the browser.
const LAYERS = new Set(['clouds_new', 'temp_new', 'wind_new', 'pressure_new', 'precipitation_new'])
const INT = /^\d{1,7}$/

export async function GET(
  _req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ layer: string; z: string; x: string; y: string }> }
) {
  const { layer, z, x, y } = await paramsPromise
  const { user } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.OPENWEATHER_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  // Strict whitelist / numeric checks: nothing user-controlled reaches the upstream URL unvalidated.
  if (!LAYERS.has(layer) || !INT.test(z) || !INT.test(x) || !INT.test(y) || Number(z) > 18) {
    return NextResponse.json({ error: 'Invalid tile' }, { status: 400 })
  }

  const upstream = await fetch(`https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${apiKey}`, {
    next: { revalidate: 600 },
  }).catch(() => null)
  if (!upstream?.ok || !upstream.body) return new NextResponse(null, { status: upstream?.status ?? 502 })

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'private, max-age=600',
    },
  })
}

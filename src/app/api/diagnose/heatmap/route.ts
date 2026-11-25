import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'

// GET /api/diagnose/heatmap?days=90&crop=Rice&scope=me|all
// Returns: { points: [{ id, lat, lng, crop_type, disease_name, severity, status, created_at, is_mine }], count }
//
// Privacy by design: data comes from the database function public.disease_heatmap(),
// which returns anonymised points only — no user ids, and each farm location rounded
// to ~1 km. Diagnoses aren't geotagged, so each one is placed at its owner's first farm.

type Row = {
  id: string
  lat: number
  lng: number
  crop_type: string
  disease_name: string | null
  severity: string | null
  status: string
  created_at: string
  is_mine: boolean
}

// Deterministic jitter (~±250 m) so outbreaks from the same rounded location don't fully overlap.
function jitter(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const r1 = (h & 0xffff) / 0xffff - 0.5
  const r2 = ((h >>> 16) & 0xffff) / 0xffff - 0.5
  return { dLat: r1 * 0.005, dLng: r2 * 0.005 }
}

export async function GET(req: NextRequest) {
  const { user, supabase } = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const days = Math.max(1, Math.min(730, Number(sp.get('days')) || 90))
  const crop = sp.get('crop')?.trim().slice(0, 40) || null
  const scope = sp.get('scope') === 'me' ? 'me' : 'all'

  const { data, error } = await supabase.rpc('disease_heatmap', { p_days: days, p_crop: crop })
  if (error) {
    console.error('[/api/diagnose/heatmap]', error.message)
    return NextResponse.json({ error: 'Could not load the heatmap. Please try again.' }, { status: 500 })
  }

  const points = ((data ?? []) as Row[])
    .filter((r) => scope === 'all' || r.is_mine)
    .map((r) => {
      const { dLat, dLng } = jitter(r.id)
      return { ...r, lat: Number(r.lat) + dLat, lng: Number(r.lng) + dLng, severity: r.severity ?? 'unknown' }
    })

  return NextResponse.json({ points, count: points.length })
}

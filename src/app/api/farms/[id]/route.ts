import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { serverError } from '@/lib/api-error'

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('farms')
      .select('*, crop_cycles(*)')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'Farm not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err: unknown) {
    return serverError('/api/farms/[id]', err)
  }
}

export async function PUT(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Whitelist: only these fields are user-editable (never user_id, polygon ids, snapshots…).
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const num = (v: unknown) => (v === '' || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : undefined)
    const text = (v: unknown, max: number) => (v === null || v === '' ? null : typeof v === 'string' ? v.trim().slice(0, max) : undefined)
    const update: Record<string, unknown> = {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : undefined,
      total_area_acres: num(body.total_area_acres),
      lat: num(body.lat),
      lng: num(body.lng),
      soil_type: text(body.soil_type, 50),
      water_source: text(body.water_source, 50),
    }
    for (const k of Object.keys(update)) if (update[k] === undefined || !(k in body)) delete update[k]
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from('farms')
      .update(update)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    return serverError('/api/farms/[id]', err)
  }
}

export async function DELETE(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabase.from('farms').delete().eq('id', params.id).eq('user_id', user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return serverError('/api/farms/[id]', err)
  }
}

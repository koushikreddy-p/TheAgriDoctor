import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { serverError } from '@/lib/api-error'

export async function GET(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify farm ownership
    const { data: farm } = await supabase.from('farms').select('id').eq('id', params.id).eq('user_id', user.id).single()
    if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('crop_cycles')
      .select('*')
      .eq('farm_id', params.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    return serverError('/api/farms/[id]/crops', err)
  }
}

export async function POST(req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: farm } = await supabase.from('farms').select('id').eq('id', params.id).eq('user_id', user.id).single()
    if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 })

    const { crop_name, variety, sown_date, expected_harvest_date, growth_stage } = await req.json()
    if (!crop_name) return NextResponse.json({ error: 'crop_name is required' }, { status: 400 })

    const toNullIfBlank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

    const { data, error } = await supabase
      .from('crop_cycles')
      .insert({
        farm_id: params.id,
        crop_name: crop_name.trim(),
        variety: toNullIfBlank(variety),
        sown_date: toNullIfBlank(sown_date),
        expected_harvest_date: toNullIfBlank(expected_harvest_date),
        growth_stage: toNullIfBlank(growth_stage) ?? 'seedling',
        status: 'active',
      })
      .select('*')
      .single()

    if (error) {
      console.error('[/api/farms/.../crops] insert error:', error)
      return serverError('/api/farms/[id]/crops', error)
    }
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    console.error('[/api/farms/.../crops] unhandled error:', err)
    return serverError('/api/farms/[id]/crops', err)
  }
}

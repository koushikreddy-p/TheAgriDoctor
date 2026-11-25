import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { aiJson, AiChainError, VISION_CHAIN } from '@/lib/ai'
import { rateLimitResponse } from '@/lib/rate-limit'
import type { DiagnosisReport } from '@/types/diagnose'

export const maxDuration = 60

const MAX_IMAGES = 5
// Vercel rejects request bodies above ~4.5 MB; the client compresses photos well below this.
const MAX_TOTAL_BASE64_CHARS = 4_000_000

const SYSTEM_PROMPT = `You are an expert agricultural pathologist. Analyze the crop image(s) and return ONLY valid JSON with no markdown, no code fences, no explanation — just raw JSON.

The JSON must follow this exact schema:
{
  "disease_name": string,
  "is_diseased": boolean,
  "confidence_pct": number,
  "affected_part": "leaf" | "stem" | "fruit" | "root",
  "severity": "low" | "medium" | "high" | "critical",
  "cause": string,
  "symptoms": string[],
  "organic_treatment": string[],
  "chemical_treatment": [{"product": string, "dosage": string, "frequency": string}],
  "prevention_tips": string[],
  "estimated_yield_loss_pct_if_untreated": number,
  "urgency_days": number
}

If the plant looks healthy, set "is_diseased": false, "disease_name": "Healthy", "severity": "low".`

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const PARTS = ['leaf', 'stem', 'fruit', 'root'] as const

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback)
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : [])
const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
}

/** Validate + normalise the model output so the UI never receives a malformed report. */
function validateReport(value: unknown): DiagnosisReport {
  if (!value || typeof value !== 'object') throw new Error('report is not an object')
  const r = value as Record<string, unknown>
  const disease_name = str(r.disease_name)
  if (!disease_name) throw new Error('missing disease_name')
  if (r.severity === undefined || r.is_diseased === undefined) throw new Error('missing severity / is_diseased')

  let confidence = Number(r.confidence_pct)
  if (Number.isFinite(confidence) && confidence > 0 && confidence <= 1) confidence *= 100 // model replied 0.87 instead of 87

  return {
    disease_name,
    is_diseased: r.is_diseased === true || r.is_diseased === 'true',
    confidence_pct: clamp(confidence, 0, 100, 0),
    affected_part: (PARTS as readonly string[]).includes(r.affected_part as string) ? (r.affected_part as DiagnosisReport['affected_part']) : 'leaf',
    severity: (SEVERITIES as readonly string[]).includes(r.severity as string) ? (r.severity as DiagnosisReport['severity']) : 'medium',
    cause: str(r.cause),
    symptoms: strArr(r.symptoms),
    organic_treatment: strArr(r.organic_treatment),
    chemical_treatment: Array.isArray(r.chemical_treatment)
      ? r.chemical_treatment
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .map((c) => ({ product: str(c.product), dosage: str(c.dosage), frequency: str(c.frequency) }))
          .filter((c) => c.product)
          .slice(0, 8)
      : [],
    prevention_tips: strArr(r.prevention_tips),
    estimated_yield_loss_pct_if_untreated: clamp(r.estimated_yield_loss_pct_if_untreated, 0, 100, 0),
    urgency_days: clamp(r.urgency_days, 0, 365, 7),
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, supabase } = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limited = rateLimitResponse('diagnose', user.id)
    if (limited) return limited

    const body = (await req.json().catch(() => ({}))) as { imageBase64Array?: unknown; cropType?: unknown; imagePaths?: unknown }
    const imageBase64Array = body.imageBase64Array as string[]
    // Crop name goes into the AI prompt: keep it short and plain to limit prompt injection.
    const cropType = typeof body.cropType === 'string' ? body.cropType.replace(/[^A-Za-z0-9 ()\-\u0900-\u0DFF]/g, '').trim().slice(0, 40) : ''

    if (!Array.isArray(imageBase64Array) || !imageBase64Array.length || !cropType) {
      return NextResponse.json({ error: 'imageBase64Array and cropType are required' }, { status: 400 })
    }
    if (imageBase64Array.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images allowed` }, { status: 400 })
    }
    if (!imageBase64Array.every((s) => typeof s === 'string' && /^data:image\/[a-z+.-]+;base64,/i.test(s))) {
      return NextResponse.json({ error: 'Images must be base64 image data URLs' }, { status: 400 })
    }
    if (imageBase64Array.reduce((n, s) => n + s.length, 0) > MAX_TOTAL_BASE64_CHARS) {
      return NextResponse.json({ error: 'Images are too large. Please upload fewer or smaller photos.' }, { status: 413 })
    }

    // Only accept storage paths of the exact shape our uploader creates, inside this user's own folder.
    // (Storage policies enforce the same rule; this keeps junk out of the database.)
    const ownPath = new RegExp(`^${user.id}/[A-Za-z0-9_-]+\\.(jpg|png)$`)
    const imagePaths: string[] = Array.isArray(body.imagePaths)
      ? (body.imagePaths as unknown[]).filter((p): p is string => typeof p === 'string' && ownPath.test(p)).slice(0, MAX_IMAGES)
      : []

    let report: DiagnosisReport
    let model: string
    try {
      const result = await aiJson(
        {
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Analyze this ${cropType} crop image for diseases. Return only the JSON object, nothing else.` }],
          images: imageBase64Array,
        },
        validateReport,
        { label: 'diagnose', chain: VISION_CHAIN, maxTokens: 1500, temperature: 0.1, attemptTimeoutMs: 30_000 }
      )
      report = result.data
      model = result.model
    } catch (err) {
      const busy = err instanceof AiChainError
      return NextResponse.json(
        { error: busy ? 'All AI vision models are busy right now. Please try again in a minute.' : 'The AI could not produce a valid report. Please try again with a clearer photo.' },
        { status: busy ? 503 : 502 }
      )
    }

    const { data: diagnosis, error: dbError } = await supabase
      .from('diagnoses')
      .insert({
        user_id: user.id,
        crop_type: cropType,
        image_urls: imagePaths,
        disease_name: report.disease_name,
        confidence_pct: report.confidence_pct,
        severity: report.severity,
        full_report_json: report,
        status: 'open',
        ai_model: model,
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('[/api/diagnose] DB insert error:', dbError)
      return NextResponse.json({ report, diagnosisId: null, model, warning: 'Result not saved to database' })
    }
    return NextResponse.json({ report, diagnosisId: diagnosis.id, model })
  } catch (err: unknown) {
    console.error('[/api/diagnose] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

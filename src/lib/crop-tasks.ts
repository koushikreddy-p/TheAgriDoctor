import { aiJson } from '@/lib/ai'

export type TaskCategory = 'irrigation' | 'fertilization' | 'pest' | 'weeding' | 'monitoring' | 'harvest' | 'other'
export type TaskPriority = 'low' | 'medium' | 'high'

export type GeneratedTask = {
  title: string
  description: string
  category: TaskCategory
  priority: TaskPriority
  due_offset_days: number // days from today
}

export type GenerateTasksInput = {
  crop_name: string
  variety?: string | null
  growth_stage?: string | null
  sown_date?: string | null
  expected_harvest_date?: string | null
  soil_type?: string | null
  water_source?: string | null
  location?: string | null
  language?: string | null
}

const SYSTEM_PROMPT = `You are an expert Indian agronomist. Given a crop cycle, generate a prioritized, actionable
task checklist that the farmer should complete in the next 14 days. Keep each task specific, concise, and grounded
in Indian smallholder-farming practice. Use locally-relevant inputs and measurements (kg/acre, litres, °C).

CRITICAL RULES:
1. You MUST respond with ONLY a valid JSON object. No explanatory text, markdown, or code fences.
2. Keep descriptions SHORT (max 120 characters). Be concise!
3. Your entire response must be parseable as JSON.

Return this exact JSON structure:
{
  "tasks": [
    {
      "title": "short action title (max 60 chars)",
      "description": "one brief sentence only (max 120 chars)",
      "category": "irrigation" | "fertilization" | "pest" | "weeding" | "monitoring" | "harvest" | "other",
      "priority": "low" | "medium" | "high",
      "due_offset_days": 0-30
    }
  ]
}

Generate 4 to 6 tasks. Sort by urgency. Remember: ONLY return the JSON object, keep descriptions very short.`

export async function generateTasks(input: GenerateTasksInput): Promise<GeneratedTask[]> {
  const userMsg = [
    `Crop: ${input.crop_name}${input.variety ? ` (${input.variety})` : ''}`,
    input.growth_stage ? `Growth stage: ${input.growth_stage}` : null,
    input.sown_date ? `Sown on: ${input.sown_date}` : null,
    input.expected_harvest_date ? `Expected harvest: ${input.expected_harvest_date}` : null,
    input.soil_type ? `Soil: ${input.soil_type}` : null,
    input.water_source ? `Water source: ${input.water_source}` : null,
    input.location ? `Location: ${input.location}` : null,
    input.language && input.language !== 'English'
      ? `Reply titles & descriptions in ${input.language} language (English task field names).`
      : null,
    '',
    'Produce the JSON now.',
  ]
    .filter(Boolean)
    .join('\n')

  const CATS: TaskCategory[] = ['irrigation', 'fertilization', 'pest', 'weeding', 'monitoring', 'harvest', 'other']
  const PRI: TaskPriority[] = ['low', 'medium', 'high']

  // Validate + normalise; throwing here makes aiJson retry on a different model.
  const validate = (value: unknown): GeneratedTask[] => {
    const tasks = (value as { tasks?: unknown })?.tasks
    if (!Array.isArray(tasks)) throw new Error('missing "tasks" array')
    const out: GeneratedTask[] = []
    for (const t of tasks) {
      if (!t || typeof t !== 'object') continue
      const r = t as Record<string, unknown>
      const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : ''
      if (!title) continue
      const description = typeof r.description === 'string' ? r.description.trim().slice(0, 400) : ''
      const category = (CATS as string[]).includes(r.category as string) ? (r.category as TaskCategory) : 'other'
      const priority = (PRI as string[]).includes(r.priority as string) ? (r.priority as TaskPriority) : 'medium'
      const rawDue = Number(r.due_offset_days)
      const due_offset_days = Number.isFinite(rawDue) ? Math.max(0, Math.min(30, Math.round(rawDue))) : 0
      out.push({ title, description, category, priority, due_offset_days })
    }
    if (out.length === 0) throw new Error('no valid tasks')
    return out.sort((a, b) => a.due_offset_days - b.due_offset_days).slice(0, 8)
  }

  const { data } = await aiJson(
    { system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg }] },
    validate,
    { label: 'crop-tasks', maxTokens: 1500, temperature: 0.35 }
  )
  return data
}

export function dueDateFromOffset(offsetDays: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

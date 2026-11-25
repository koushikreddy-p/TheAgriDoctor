// Client-safe display names for the models in the AI fallback chain (no secrets here).

export type ModelInfo = { name: string; vendor: string; via: 'OpenRouter' | 'Google AI' }

const MODELS: Record<string, ModelInfo> = {
  'nvidia/nemotron-3-super-120b-a12b:free': { name: 'Nemotron 3 Super 120B', vendor: 'NVIDIA', via: 'OpenRouter' },
  'meta-llama/llama-3.3-70b-instruct:free': { name: 'Llama 3.3 70B', vendor: 'Meta', via: 'OpenRouter' },
  'google/gemma-3-27b-it:free': { name: 'Gemma 3 27B', vendor: 'Google', via: 'OpenRouter' },
  'qwen/qwen2.5-vl-72b-instruct:free': { name: 'Qwen 2.5 VL 72B', vendor: 'Alibaba', via: 'OpenRouter' },
  'meta-llama/llama-3.2-11b-vision-instruct:free': { name: 'Llama 3.2 11B Vision', vendor: 'Meta', via: 'OpenRouter' },
  'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', vendor: 'Google', via: 'Google AI' },
  'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash-Lite', vendor: 'Google', via: 'Google AI' },
}

export function modelInfo(id: string | null | undefined): ModelInfo | null {
  if (!id) return null
  return MODELS[id] ?? { name: id.split('/').pop()?.replace(/:free$/, '') ?? id, vendor: '', via: id.includes('/') ? 'OpenRouter' : 'Google AI' }
}

/** Short label like "Gemini 2.5 Flash". */
export function modelName(id: string | null | undefined): string {
  return modelInfo(id)?.name ?? 'AI'
}

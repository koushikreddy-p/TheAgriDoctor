/**
 * TheAgriDoctor — unified, fault-tolerant AI gateway.
 *
 * Every AI feature (crop diagnosis, advisor chat, task planner, community
 * replies) goes through this single module. A request walks an ordered
 * "fallback chain" of models until one succeeds:
 *
 *   OpenRouter free model #1 → OpenRouter free model #2 (→ #3) → Google Gemini 2.5 Flash → Gemini 2.5 Flash-Lite
 *
 * Reliability features:
 *   • Per-attempt timeouts + an overall deadline, so one hung model can never
 *     stall the request (the next model gets its turn instead).
 *   • Cool-down "circuit breaker": a model that just returned 429 / 5xx / 404
 *     is moved to the back of the queue for a while, so later requests skip
 *     straight to a healthy model instead of waiting on a known-bad one.
 *   • Provider-level short-circuit: a 401/403 (bad key) skips that provider's
 *     remaining models immediately.
 *   • Native JSON mode on both providers for structured tasks, plus a
 *     validate-and-retry-on-the-next-model loop (aiJson).
 *   • True token streaming on BOTH providers (aiStream), with correct SSE
 *     line buffering and failover until the first token is received.
 *   • Structured logs of every attempt: which model answered and how fast.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant'
export type Msg = { role: Role; content: string }

export type Provider = 'openrouter' | 'gemini'
export type ChainStep = { provider: Provider; model: string }

/** A provider-neutral request. Images (base64 data URLs) attach to the last user turn. */
export type AiRequest = {
  system?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  images?: string[]
}

export type AiOptions = {
  /** Short label for logs, e.g. "diagnose", "chat". */
  label?: string
  maxTokens?: number
  temperature?: number
  /** Ask the model for a raw JSON object (native JSON mode). */
  json?: boolean
  /** Timeout per model attempt (ms). */
  attemptTimeoutMs?: number
  /** Hard ceiling for the whole chain (ms). Keep below the route's maxDuration. */
  deadlineMs?: number
  /** Override the default chain. */
  chain?: ChainStep[]
  /** Models to skip (used internally by aiJson to move past a model that produced bad JSON). */
  exclude?: Set<string>
  /**
   * DEMO / DIAGNOSTICS ONLY: models (as "provider:model") that should fail with a
   * simulated outage, without any network call and without affecting real health
   * state. Used by the AI Engine status page to demonstrate failover live.
   */
  simulateFailures?: Set<string>
}

export type Attempt = {
  provider: Provider
  model: string
  ok: boolean
  ms: number
  status?: number
  error?: string
}

export type AiResult = {
  text: string
  provider: Provider
  model: string
  latencyMs: number
  attempts: Attempt[]
}

export class AiChainError extends Error {
  attempts: Attempt[]
  constructor(message: string, attempts: Attempt[]) {
    super(message)
    this.name = 'AiChainError'
    this.attempts = attempts
  }
}

// ─── Fallback chains ──────────────────────────────────────────────────────────

const GEMINI_STEPS: ChainStep[] = [
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
]

/** Text: task planner, community replies, advisor chat. */
export const TEXT_CHAIN: ChainStep[] = [
  { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  ...GEMINI_STEPS,
]

/** Vision: crop disease diagnosis from photos. */
export const VISION_CHAIN: ChainStep[] = [
  { provider: 'openrouter', model: 'google/gemma-3-27b-it:free' },
  { provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.2-11b-vision-instruct:free' },
  ...GEMINI_STEPS,
]

// Optional overrides (e.g. a corporate AI gateway, or a local mock for testing). Server-side env only.
const OPENROUTER_URL = `${(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`
const GEMINI_BASE = `${(process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models`

const DEFAULTS = {
  attemptTimeoutMs: 30_000,
  deadlineMs: 55_000,
  firstTokenTimeoutMs: 20_000,
  streamIdleTimeoutMs: 30_000,
}

// ─── Circuit breaker (per warm server instance) ───────────────────────────────

const cooldownUntil = new Map<string, number>()
export const stepKey = (s: ChainStep) => `${s.provider}:${s.model}`

function coolDown(step: ChainStep, ms: number) {
  cooldownUntil.set(stepKey(step), Date.now() + ms)
}

/**
 * Order the chain so healthy models come first and cooling-down models last.
 * Cooling-down models are deprioritised, never dropped — if everything is
 * cooling down we still try them rather than fail without an attempt.
 */
function orderChain(chain: ChainStep[], exclude?: Set<string>): ChainStep[] {
  const now = Date.now()
  const usable = chain.filter((s) => !exclude?.has(stepKey(s)))
  const healthy = usable.filter((s) => (cooldownUntil.get(stepKey(s)) ?? 0) <= now)
  const cooling = usable.filter((s) => (cooldownUntil.get(stepKey(s)) ?? 0) > now)
  return [...healthy, ...cooling]
}

// ─── Errors ───────────────────────────────────────────────────────────────────

class ProviderError extends Error {
  status?: number
  /** True for failures injected by the simulateFailures option (never cools a model down). */
  simulated?: boolean
  /** True when the whole provider is unusable (bad / missing key). */
  providerFatal: boolean
  retryAfterMs?: number
  constructor(message: string, opts: { status?: number; providerFatal?: boolean; retryAfterMs?: number } = {}) {
    super(message)
    this.status = opts.status
    this.providerFatal = opts.providerFatal ?? false
    this.retryAfterMs = opts.retryAfterMs
  }
}

async function errorFromResponse(step: ChainStep, res: Response): Promise<ProviderError> {
  const body = (await res.text().catch(() => '')).slice(0, 300)
  const retryAfter = Number(res.headers.get('retry-after'))
  return new ProviderError(`${step.provider} ${step.model} → HTTP ${res.status}: ${body}`, {
    status: res.status,
    providerFatal: res.status === 401 || res.status === 403,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
  })
}

/** Decide how long a failing model should sit out. */
function applyCooldown(step: ChainStep, err: unknown) {
  if (!(err instanceof ProviderError) || err.simulated) return
  if (err.status === 429) coolDown(step, err.retryAfterMs ?? 60_000)
  else if (err.status === 404) coolDown(step, 10 * 60_000) // model retired / renamed
  else if (err.status && err.status >= 500) coolDown(step, 20_000)
  else if (err.status === 408) coolDown(step, 30_000) // our own timeout
}

function keyFor(provider: Provider): string | undefined {
  return provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY
}

// ─── Timeouts ─────────────────────────────────────────────────────────────────

function withTimeout(ms: number, parent?: AbortSignal) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new ProviderError(`timed out after ${ms} ms`, { status: 408 })), ms)
  parent?.addEventListener('abort', () => ctrl.abort(parent.reason), { once: true })
  return { signal: ctrl.signal, abort: (r?: unknown) => ctrl.abort(r), clear: () => clearTimeout(timer) }
}

function asProviderError(e: unknown, signal: AbortSignal): unknown {
  if (signal.aborted && signal.reason instanceof ProviderError) return signal.reason
  return e
}

// ─── Request builders ─────────────────────────────────────────────────────────

function parseDataUrl(url: string): { mime: string; data: string } {
  const m = url.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) throw new ProviderError('invalid base64 image data URL', { status: 400 })
  return { mime: m[1], data: m[2] }
}

function openRouterBody(step: ChainStep, req: AiRequest, opts: AiOptions, stream: boolean) {
  const msgs: unknown[] = []
  if (req.system) msgs.push({ role: 'system', content: req.system })
  req.messages.forEach((m, i) => {
    const isLastUser = i === req.messages.length - 1 && m.role === 'user'
    if (isLastUser && req.images?.length) {
      msgs.push({
        role: 'user',
        content: [
          ...req.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          { type: 'text', text: m.content },
        ],
      })
    } else {
      msgs.push({ role: m.role, content: m.content })
    }
  })
  return {
    model: step.model,
    messages: msgs,
    max_tokens: opts.maxTokens ?? 1000,
    temperature: opts.temperature ?? 0.4,
    stream,
    // Ignored by models that don't support it (OpenRouter drops unsupported params).
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }
}

function openRouterHeaders(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://theagridoctor.vercel.app',
    'X-Title': 'TheAgriDoctor',
  }
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } }
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

function geminiBody(req: AiRequest, opts: AiOptions) {
  // Proper multi-turn conversation (user/model roles), merging consecutive same-role turns.
  const contents: GeminiContent[] = []
  req.messages.forEach((m, i) => {
    const role = m.role === 'assistant' ? 'model' : 'user'
    const parts: GeminiPart[] = []
    const isLastUser = i === req.messages.length - 1 && m.role === 'user'
    if (isLastUser && req.images?.length) {
      for (const url of req.images) {
        const { mime, data } = parseDataUrl(url)
        parts.push({ inline_data: { mime_type: mime, data } })
      }
    }
    parts.push({ text: m.content })
    const prev = contents[contents.length - 1]
    if (prev && prev.role === role) prev.parts.push(...parts)
    else contents.push({ role, parts })
  })
  if (contents[0]?.role === 'model') contents.unshift({ role: 'user', parts: [{ text: '(conversation continues)' }] })

  return {
    contents,
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1000,
      temperature: opts.temperature ?? 0.4,
      // Gemini 2.5 "thinking" tokens count against maxOutputTokens and can
      // leave no room for the visible answer. These tasks don't need it.
      thinkingConfig: { thinkingBudget: 0 },
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
}

function geminiText(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts
  return parts?.map((p) => p.text ?? '').join('') ?? ''
}

// ─── Single (non-streaming) attempt ───────────────────────────────────────────

function simulatedOutage(step: ChainStep, opts: AiOptions) {
  if (!opts.simulateFailures?.has(stepKey(step))) return
  const e = new ProviderError(`${step.model} → simulated outage (HTTP 503)`, { status: 503 })
  e.simulated = true
  throw e
}

async function callOnce(step: ChainStep, req: AiRequest, opts: AiOptions, signal: AbortSignal): Promise<string> {
  simulatedOutage(step, opts)
  const key = keyFor(step.provider)
  if (!key) throw new ProviderError(`${step.provider} API key not configured`, { providerFatal: true })

  let res: Response
  if (step.provider === 'openrouter') {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(key),
      body: JSON.stringify(openRouterBody(step, req, opts, false)),
      signal,
    })
  } else {
    res = await fetch(`${GEMINI_BASE}/${step.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiBody(req, opts)),
      signal,
    })
  }
  if (!res.ok) throw await errorFromResponse(step, res)

  const json = await res.json()
  const text =
    step.provider === 'openrouter'
      ? ((json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '')
      : geminiText(json)
  if (!text.trim()) throw new ProviderError(`${step.model} returned an empty response`)
  return text.trim()
}

export type RecentRequest = { at: string; label: string; ok: boolean; model?: string; latencyMs?: number; attempts: Attempt[] }
const RECENT_MAX = 25
const recent: RecentRequest[] = []

function logResult(label: string, ok: boolean, attempts: Attempt[], extra: Record<string, unknown> = {}) {
  recent.unshift({
    at: new Date().toISOString(),
    label,
    ok,
    model: extra.model as string | undefined,
    latencyMs: (extra.latencyMs ?? extra.firstTokenMs) as number | undefined,
    attempts: attempts.map((a) => ({ ...a })),
  })
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX
  const line = JSON.stringify({ label, ok, ...extra, attempts })
  if (ok) console.info('[ai]', line)
  else console.error('[ai]', line)
}

/** Run a request through the fallback chain. Returns the first successful answer plus diagnostics. */
export async function aiGenerate(req: AiRequest, opts: AiOptions = {}): Promise<AiResult> {
  const label = opts.label ?? 'ai'
  const started = Date.now()
  const deadline = started + (opts.deadlineMs ?? DEFAULTS.deadlineMs)
  const attempts: Attempt[] = []
  const deadProviders = new Set<Provider>()

  for (const step of orderChain(opts.chain ?? TEXT_CHAIN, opts.exclude)) {
    if (deadProviders.has(step.provider)) continue
    const remaining = deadline - Date.now()
    if (remaining < 2_000) break

    const t0 = Date.now()
    const t = withTimeout(Math.min(opts.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs, remaining))
    try {
      const text = await callOnce(step, req, opts, t.signal)
      const ms = Date.now() - t0
      attempts.push({ provider: step.provider, model: step.model, ok: true, ms })
      const result = { text, provider: step.provider, model: step.model, latencyMs: Date.now() - started, attempts }
      logResult(label, true, attempts, { model: step.model, latencyMs: result.latencyMs })
      return result
    } catch (raw) {
      const err = asProviderError(raw, t.signal)
      applyCooldown(step, err)
      if (err instanceof ProviderError && err.providerFatal) deadProviders.add(step.provider)
      attempts.push({
        provider: step.provider,
        model: step.model,
        ok: false,
        ms: Date.now() - t0,
        status: err instanceof ProviderError ? err.status : undefined,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      })
    } finally {
      t.clear()
    }
  }

  logResult(label, false, attempts)
  throw new AiChainError('All AI providers failed', attempts)
}

// ─── Structured JSON helper ───────────────────────────────────────────────────

/** Pull the first {...} object out of a model response (tolerates code fences / stray prose). */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('no JSON object in response')
  return JSON.parse(cleaned.slice(first, last + 1))
}

/**
 * Ask for JSON and validate it. If a model returns malformed / invalid JSON,
 * the next attempt automatically moves on to a *different* model.
 * `validate` must return the typed value or throw.
 */
export async function aiJson<T>(
  req: AiRequest,
  validate: (value: unknown) => T,
  opts: AiOptions & { maxParseRetries?: number } = {}
): Promise<AiResult & { data: T }> {
  const exclude = new Set(opts.exclude ?? [])
  const maxRetries = opts.maxParseRetries ?? 2
  const started = Date.now()
  const totalDeadline = opts.deadlineMs ?? DEFAULTS.deadlineMs
  let lastErr: unknown

  for (let i = 0; i <= maxRetries; i++) {
    const remaining = totalDeadline - (Date.now() - started)
    if (remaining < 3_000) break
    const result = await aiGenerate(req, { ...opts, json: true, exclude, deadlineMs: remaining })
    try {
      return { ...result, data: validate(extractJsonObject(result.text)) }
    } catch (e) {
      lastErr = e
      console.warn(`[ai] ${opts.label ?? 'json'}: ${result.model} returned invalid JSON (${e instanceof Error ? e.message : e}); trying next model`)
      exclude.add(stepKey({ provider: result.provider, model: result.model }))
    }
  }
  throw new Error(`AI returned invalid JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

// ─── Backwards-compatible helper ──────────────────────────────────────────────

/** Plain text completion from an OpenAI-style message list. */
export async function aiText(messages: Msg[], opts: AiOptions = {}): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined
  const rest = messages.filter((m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system')
  return (await aiGenerate({ system, messages: rest }, opts)).text
}

// ─── Streaming ────────────────────────────────────────────────────────────────

/**
 * Parse a Server-Sent-Events byte stream into `data:` payloads.
 * Buffers partial lines across network chunks and decodes UTF-8 in streaming
 * mode, so multi-byte characters (Hindi, Telugu…) are never split or dropped.
 */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) yield line.slice(5).trimStart()
        // lines starting with ':' are keep-alive comments; blank lines end events
      }
      if (done) {
        if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart()
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function* streamTokens(step: ChainStep, req: AiRequest, opts: AiOptions, signal: AbortSignal): AsyncGenerator<string> {
  simulatedOutage(step, opts)
  const key = keyFor(step.provider)
  if (!key) throw new ProviderError(`${step.provider} API key not configured`, { providerFatal: true })

  let res: Response
  if (step.provider === 'openrouter') {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(key),
      body: JSON.stringify(openRouterBody(step, req, opts, true)),
      signal,
    })
  } else {
    res = await fetch(`${GEMINI_BASE}/${step.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(geminiBody(req, opts)),
      signal,
    })
  }
  if (!res.ok || !res.body) throw await errorFromResponse(step, res)

  for await (const data of sseData(res.body)) {
    if (!data || data === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    if (step.provider === 'openrouter') {
      const p = parsed as { error?: { message?: string; code?: number }; choices?: { delta?: { content?: string }; finish_reason?: string }[] }
      if (p.error) throw new ProviderError(`${step.model} stream error: ${p.error.message ?? 'unknown'}`, { status: p.error.code })
      const token = p.choices?.[0]?.delta?.content
      if (token) yield token
    } else {
      const token = geminiText(parsed)
      if (token) yield token
    }
  }
}

export type AiStream = {
  provider: Provider
  model: string
  attempts: Attempt[]
  /** UTF-8 encoded text tokens, ready to return as a Response body. */
  stream: ReadableStream<Uint8Array>
  /** Resolves with the full text once streaming ends (also on client disconnect). */
  done: Promise<{ text: string; completed: boolean }>
}

/**
 * Streaming completion with failover. Resolves as soon as some model produces
 * its first token — failures before that point fall through to the next model,
 * so the user never sees a half-broken answer from a dead provider.
 */
export async function aiStream(req: AiRequest, opts: AiOptions = {}): Promise<AiStream> {
  const label = opts.label ?? 'stream'
  const started = Date.now()
  const deadline = started + (opts.deadlineMs ?? DEFAULTS.deadlineMs)
  const attempts: Attempt[] = []
  const deadProviders = new Set<Provider>()

  for (const step of orderChain(opts.chain ?? TEXT_CHAIN, opts.exclude)) {
    if (deadProviders.has(step.provider)) continue
    const remaining = deadline - Date.now()
    if (remaining < 2_000) break

    const t0 = Date.now()
    const t = withTimeout(Math.min(DEFAULTS.firstTokenTimeoutMs, remaining))
    const it = streamTokens(step, req, opts, t.signal)
    try {
      // Wait for the first non-empty token (or end of stream).
      let first = await it.next()
      while (!first.done && !first.value) first = await it.next()
      if (first.done) throw new ProviderError(`${step.model} returned an empty stream`)
      t.clear()

      attempts.push({ provider: step.provider, model: step.model, ok: true, ms: Date.now() - t0 })
      logResult(label, true, attempts, { model: step.model, firstTokenMs: Date.now() - started })

      return buildStream(step, attempts, it, first.value, t)
    } catch (raw) {
      t.clear()
      t.abort()
      const err = asProviderError(raw, t.signal)
      applyCooldown(step, err)
      if (err instanceof ProviderError && err.providerFatal) deadProviders.add(step.provider)
      attempts.push({
        provider: step.provider,
        model: step.model,
        ok: false,
        ms: Date.now() - t0,
        status: err instanceof ProviderError ? err.status : undefined,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      })
    }
  }

  logResult(label, false, attempts)
  throw new AiChainError('All AI providers failed', attempts)
}

function buildStream(
  step: ChainStep,
  attempts: Attempt[],
  it: AsyncGenerator<string>,
  firstToken: string,
  t: ReturnType<typeof withTimeout>
): AiStream {
  const encoder = new TextEncoder()
  let full = firstToken
  let resolveDone!: (v: { text: string; completed: boolean }) => void
  const done = new Promise<{ text: string; completed: boolean }>((r) => (resolveDone = r))
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () => t.abort(new ProviderError(`stream idle > ${DEFAULTS.streamIdleTimeoutMs} ms`, { status: 408 })),
      DEFAULTS.streamIdleTimeoutMs
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(firstToken))
      armIdle()
    },
    async pull(controller) {
      try {
        const { done: finished, value } = await it.next()
        if (finished) {
          clearTimeout(idleTimer)
          controller.close()
          resolveDone({ text: full, completed: true })
          return
        }
        armIdle()
        full += value
        controller.enqueue(encoder.encode(value))
      } catch (e) {
        // Mid-stream failure: keep what the user already received, end cleanly.
        clearTimeout(idleTimer)
        console.warn(`[ai] ${step.model} stream interrupted:`, e instanceof Error ? e.message : e)
        controller.close()
        resolveDone({ text: full, completed: false })
      }
    },
    cancel() {
      // Client disconnected.
      clearTimeout(idleTimer)
      t.abort()
      void it.return(undefined)
      resolveDone({ text: full, completed: false })
    },
  })

  return { provider: step.provider, model: step.model, attempts, stream, done }
}

// ─── Diagnostics (AI Engine status page) ──────────────────────────────────────

export type StepHealth = ChainStep & { keyConfigured: boolean; coolingDownMs: number }

/** Current health of every model in a chain, as seen by this server instance. */
export function getChainHealth(chain: ChainStep[]): StepHealth[] {
  const now = Date.now()
  return chain.map((s) => ({
    ...s,
    keyConfigured: !!keyFor(s.provider),
    coolingDownMs: Math.max(0, (cooldownUntil.get(stepKey(s)) ?? 0) - now),
  }))
}

/** Most recent AI requests handled by this server instance (newest first). */
export function getRecentRequests(): RecentRequest[] {
  return recent.map((r) => ({ ...r, attempts: r.attempts.map((a) => ({ ...a })) }))
}

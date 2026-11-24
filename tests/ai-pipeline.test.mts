import assert from 'node:assert/strict'
// Simulated-network tests for the AI fallback pipeline. Run: npm test
import * as aiMod from '../src/lib/ai.ts'
const ai: typeof aiMod = (aiMod as any).default ?? aiMod

type Handler = (url: string, init: RequestInit) => Promise<Response>
let handler: Handler
const calls: { url: string; headers: Record<string, string>; body: any }[] = []
;(globalThis as any).fetch = (url: string, init: RequestInit) => {
  calls.push({ url, headers: init.headers as any, body: JSON.parse(init.body as string) })
  return handler(url, init)
}
process.env.OPENROUTER_API_KEY = 'or-key'
process.env.GEMINI_API_KEY = 'gm-key'

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })
const orOk = (text: string) => json({ choices: [{ message: { content: text } }] })
const gmOk = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] })
const modelOf = (c: { url: string; body: any }) => c.body.model ?? c.url.match(/models\/([^:]+)/)?.[1]
const hang = (init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))

// Stream bytes split at awkward places (mid-line, mid multi-byte char)
function sseResponse(payloads: string[], splitEvery = 7, failAfter?: number) {
  const bytes = new TextEncoder().encode(payloads.map((p) => `data: ${p}\r\n\r\n`).join('') + ': keepalive\n')
  let i = 0
  return new Response(new ReadableStream({
    pull(c) {
      if (failAfter !== undefined && i >= failAfter) { c.error(new Error('socket reset')); return }
      if (i >= bytes.length) { c.close(); return }
      c.enqueue(bytes.slice(i, i + splitEvery)); i += splitEvery
    },
  }), { status: 200 })
}
const orDelta = (t: string) => JSON.stringify({ choices: [{ delta: { content: t } }] })
const gmDelta = (t: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })
async function readAll(s: ReadableStream<Uint8Array>) {
  const r = s.getReader(); const d = new TextDecoder(); let out = ''
  for (;;) { const { done, value } = await r.read(); if (done) break; out += d.decode(value, { stream: true }) }
  return out + d.decode()
}

const results: string[] = []
async function test(name: string, fn: () => Promise<void>) {
  calls.length = 0
  try { await fn(); results.push(`PASS  ${name}`) } catch (e) { results.push(`FAIL  ${name}: ${(e as Error).message}`); process.exitCode = 1 }
}
console.info = () => {}; console.warn = () => {}; console.error = () => {}

const CHAIN = [
  { provider: 'openrouter' as const, model: 'or-a' },
  { provider: 'openrouter' as const, model: 'or-b' },
  { provider: 'gemini' as const, model: 'gm-a' },
  { provider: 'gemini' as const, model: 'gm-b' },
]

await test('429 on model 1 falls through to model 2', async () => {
  handler = async (_u, init) => (JSON.parse(init.body as string).model === 'or-a' ? json({}, 429) : orOk('hello'))
  const r = await ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain: CHAIN })
  assert.equal(r.text, 'hello'); assert.equal(r.model, 'or-b'); assert.equal(r.attempts.length, 2)
})

await test('circuit breaker: rate-limited model is tried LAST on the next request', async () => {
  handler = async () => orOk('ok')
  const r = await ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain: CHAIN })
  assert.equal(r.model, 'or-b'); assert.equal(modelOf(calls[0]), 'or-b')
})

await test('401 (bad key) skips ALL remaining OpenRouter models, goes to Gemini', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 'x1' }, { provider: 'openrouter' as const, model: 'x2' }, { provider: 'gemini' as const, model: 'g1' }]
  handler = async (u) => (u.includes('openrouter') ? json({}, 401) : gmOk('from gemini'))
  const r = await ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(r.text, 'from gemini'); assert.equal(calls.length, 2)
})

await test('Gemini key sent in header, not URL; thinking disabled; multi-turn roles', async () => {
  const chain = [{ provider: 'gemini' as const, model: 'g1' }]
  handler = async () => gmOk('x')
  await ai.aiGenerate({ system: 'sys', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }, { chain })
  assert.ok(!calls[0].url.includes('key=')); assert.equal(calls[0].headers['x-goog-api-key'], 'gm-key')
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingBudget, 0)
  assert.deepEqual(calls[0].body.contents.map((c: any) => c.role), ['user', 'model', 'user'])
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'sys')
})

await test('hung model is abandoned after its timeout, next model answers', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 'slow' }, { provider: 'openrouter' as const, model: 'fast' }]
  handler = async (_u, init) => (JSON.parse(init.body as string).model === 'slow' ? hang(init) : orOk('fast answer'))
  const t0 = Date.now()
  const r = await ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain, attemptTimeoutMs: 300 })
  assert.equal(r.text, 'fast answer'); assert.ok(Date.now() - t0 < 2000); assert.equal(r.attempts[0].status, 408)
})

await test('all providers down → AiChainError with every attempt recorded', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 'd1' }, { provider: 'gemini' as const, model: 'd2' }]
  handler = async () => json({}, 500)
  await assert.rejects(ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain }), (e: any) => e instanceof ai.AiChainError && e.attempts.length === 2)
})

await test('images: OpenRouter image_url parts + Gemini inline_data', async () => {
  const img = 'data:image/jpeg;base64,QUJD'
  const chain = [{ provider: 'openrouter' as const, model: 'v1' }, { provider: 'gemini' as const, model: 'v2' }]
  handler = async (u) => (u.includes('openrouter') ? json({}, 503) : gmOk('seen'))
  await ai.aiGenerate({ messages: [{ role: 'user', content: 'look' }], images: [img] }, { chain })
  assert.equal(calls[0].body.messages[0].content[0].image_url.url, img)
  assert.deepEqual(calls[1].body.contents[0].parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } })
})

await test('aiJson: invalid JSON from one model → retried on a DIFFERENT model; JSON mode on', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 'j1' }, { provider: 'openrouter' as const, model: 'j2' }]
  handler = async (_u, init) => (JSON.parse(init.body as string).model === 'j1' ? orOk('Sure! here {broken') : orOk('```json\n{"tasks":[1]}\n```'))
  const r = await ai.aiJson({ messages: [{ role: 'user', content: 'x' }] }, (v: any) => { if (!Array.isArray(v.tasks)) throw new Error('bad'); return v.tasks }, { chain })
  assert.deepEqual(r.data, [1]); assert.equal(r.model, 'j2')
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' })
})

const TELUGU = 'నమస్కారం రైతు! వరి పంటకు నీరు పెట్టండి.'
await test('stream: SSE split mid-line and mid-UTF-8 char reassembles exactly (Telugu)', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 's1' }]
  const pieces = TELUGU.match(/.{1,4}/gu)!
  handler = async () => sseResponse([...pieces.map(orDelta), '[DONE]'], 5)
  const s = await ai.aiStream({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(await readAll(s.stream), TELUGU)
  assert.deepEqual(await s.done, { text: TELUGU, completed: true })
})

await test('stream: OpenRouter fails before first token → Gemini STREAMS the answer', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 's2' }, { provider: 'gemini' as const, model: 'g-stream' }]
  handler = async (u) => (u.includes('openrouter') ? json({}, 429) : sseResponse(['Hello ', 'from ', 'Gemini'].map(gmDelta), 3))
  const s = await ai.aiStream({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(s.provider, 'gemini'); assert.ok(calls[1].url.includes(':streamGenerateContent?alt=sse'))
  assert.equal(await readAll(s.stream), 'Hello from Gemini')
})

await test('stream: OpenRouter in-band error event before first token → fallback', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 's3' }, { provider: 'openrouter' as const, model: 's4' }]
  handler = async (_u, init) => JSON.parse(init.body as string).model === 's3'
    ? sseResponse([JSON.stringify({ error: { message: 'provider overloaded', code: 502 } })])
    : sseResponse([orDelta('fine'), '[DONE]'])
  const s = await ai.aiStream({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(s.model, 's4'); assert.equal(await readAll(s.stream), 'fine')
})

await test('stream: mid-stream network failure keeps partial text, closes cleanly', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 's5' }]
  handler = async () => sseResponse([orDelta('part one '), orDelta('part two'), orDelta(' never')], 8, 80)
  const s = await ai.aiStream({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  const out = await readAll(s.stream)
  const d = await s.done
  assert.equal(d.completed, false); assert.equal(d.text, out); assert.ok(out.startsWith('part one'))
})

await test('stream: empty stream counts as failure → next model', async () => {
  const chain = [{ provider: 'openrouter' as const, model: 's6' }, { provider: 'openrouter' as const, model: 's7' }]
  handler = async (_u, init) => JSON.parse(init.body as string).model === 's6' ? sseResponse(['[DONE]']) : sseResponse([orDelta('ok')])
  const s = await ai.aiStream({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(s.model, 's7')
})

await test('missing API key → provider skipped without a network call', async () => {
  delete process.env.OPENROUTER_API_KEY
  const chain = [{ provider: 'openrouter' as const, model: 'k1' }, { provider: 'gemini' as const, model: 'k2' }]
  handler = async () => gmOk('g')
  const r = await ai.aiGenerate({ messages: [{ role: 'user', content: 'hi' }] }, { chain })
  assert.equal(r.text, 'g'); assert.equal(calls.length, 1)
  process.env.OPENROUTER_API_KEY = 'or-key'
})

process.stdout.write(results.join('\n') + '\n')

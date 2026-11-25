// PREVIEW ONLY — sample data, NOT a live system. See scripts/preview/README.md
// Tiny Supabase stand-in (Auth + PostgREST + Storage subset) with demo fixtures,
// so the real app can be rendered and screenshotted without a live project.
const http = require('http')
const PORT = 54321
const UID = '11111111-1111-4111-8111-111111111111'
const now = Date.now()
const iso = (dMs) => new Date(now + dMs).toISOString()
const day = 86400000
const dateOnly = (dMs) => iso(dMs).slice(0, 10)

const user = {
  id: UID, aud: 'authenticated', role: 'authenticated', email: 'ravi.kumar@example.com',
  user_metadata: { full_name: 'Ravi Kumar' }, app_metadata: { provider: 'email' }, created_at: iso(-90 * day),
}

const snapshot = {
  scanned_at: iso(-20 * 60000),
  weather: { main: { temp: 307.4, humidity: 48, pressure: 1006, temp_min: 305, temp_max: 309 }, wind: { speed: 4.2, deg: 220 }, clouds: { all: 20 }, weather: [{ main: 'Clear', description: 'clear sky', icon: '01d' }], dt: Math.floor(now / 1000) },
  forecast: Array.from({ length: 16 }, (_, i) => ({ dt: Math.floor(now / 1000) + i * 10800, main: { temp: 300 + (i % 8), humidity: 50 + i }, weather: [{ main: i > 8 ? 'Rain' : 'Clouds' }], rain: i > 8 ? { '3h': 3.1 } : undefined })),
  soil: { dt: Math.floor(now / 1000), t0: 312.1, t10: 303.2, moisture: 0.17 },
  uvi: { dt: Math.floor(now / 1000), uvi: 8.6 },
  ndvi: { image: { dt: Math.floor((now - 3 * day) / 1000), cl: 4.2, type: 'Sentinel-2' }, stats: { mean: 0.58, min: 0.21, max: 0.81, std: 0.11, median: 0.6, num: 1200 } },
  accumulated_gdd: { dt: Math.floor(now / 1000), temp: 612.4, count: 30 },
  accumulated_rain: { dt: Math.floor(now / 1000), rain: 41.2, count: 30 },
  errors: {},
}

const farms = [
  { id: 'f1000000-0000-4000-8000-000000000001', user_id: UID, name: 'Green Valley Farm', total_area_acres: 5.5, lat: 17.4486, lng: 78.3908, soil_type: 'Black cotton', water_source: 'Borewell', agro_polygon_id: 'poly-1', polygon_area_ha: 2.2, polygon_radius_m: 300, polygon_geojson: null, last_scan_at: iso(-20 * 60000), latest_monitor_snapshot: snapshot, created_at: iso(-80 * day) },
  { id: 'f2000000-0000-4000-8000-000000000002', user_id: UID, name: 'Riverside Plot', total_area_acres: 2.0, lat: 17.3616, lng: 78.4747, soil_type: 'Red loam', water_source: 'Canal', agro_polygon_id: null, polygon_area_ha: null, last_scan_at: null, latest_monitor_snapshot: null, created_at: iso(-40 * day) },
]
const crops = [
  { id: 'c1000000-0000-4000-8000-000000000001', farm_id: farms[0].id, crop_name: 'Rice', variety: 'BPT 5204 (Sona Masuri)', sown_date: dateOnly(-45 * day), expected_harvest_date: dateOnly(75 * day), growth_stage: 'vegetative', status: 'active', created_at: iso(-45 * day), farms: { user_id: UID, name: farms[0].name, soil_type: farms[0].soil_type, water_source: farms[0].water_source } },
  { id: 'c2000000-0000-4000-8000-000000000002', farm_id: farms[0].id, crop_name: 'Chilli', variety: 'Teja', sown_date: dateOnly(-60 * day), expected_harvest_date: dateOnly(40 * day), growth_stage: 'flowering', status: 'active', created_at: iso(-60 * day), farms: { user_id: UID, name: farms[0].name, soil_type: farms[0].soil_type, water_source: farms[0].water_source } },
  { id: 'c3000000-0000-4000-8000-000000000003', farm_id: farms[1].id, crop_name: 'Tomato', variety: 'Arka Rakshak', sown_date: dateOnly(-30 * day), expected_harvest_date: dateOnly(50 * day), growth_stage: 'vegetative', status: 'active', created_at: iso(-30 * day), farms: { user_id: UID, name: farms[1].name, soil_type: farms[1].soil_type, water_source: farms[1].water_source } },
]
farms[0].crop_cycles = crops.filter((c) => c.farm_id === farms[0].id)
farms[1].crop_cycles = crops.filter((c) => c.farm_id === farms[1].id)

const report = (name, sev, conf, part = 'leaf') => ({
  disease_name: name, is_diseased: name !== 'Healthy', confidence_pct: conf, affected_part: part, severity: sev,
  cause: 'Fungal pathogen favoured by warm, humid conditions and dense canopy.',
  symptoms: ['Spindle-shaped lesions with grey centres', 'Brown margins on older leaves', 'Lesions merge in severe cases'],
  organic_treatment: ['Spray Pseudomonas fluorescens 10 g/L', 'Remove and burn infected leaves', 'Neem oil 3% spray in the evening'],
  chemical_treatment: [{ product: 'Tricyclazole 75% WP', dosage: '0.6 g per litre', frequency: 'Twice, 10–12 days apart' }, { product: 'Isoprothiolane 40% EC', dosage: '1.5 ml per litre', frequency: 'Once at early symptoms' }],
  prevention_tips: ['Avoid excess nitrogen', 'Maintain 2–3 cm standing water', 'Use resistant varieties next season'],
  estimated_yield_loss_pct_if_untreated: sev === 'high' ? 35 : sev === 'medium' ? 18 : 5, urgency_days: sev === 'high' ? 3 : 7,
})
const diagnoses = [
  { id: 'd1000000-0000-4000-8000-000000000001', user_id: UID, crop_type: 'Rice', image_urls: [`${UID}/leaf1.jpg`, `${UID}/leaf2.jpg`], disease_name: 'Rice Blast', confidence_pct: 91, severity: 'high', status: 'open', created_at: iso(-2 * day), full_report_json: report('Rice Blast', 'high', 91), ai_model: 'google/gemma-3-27b-it:free' },
  { id: 'd2000000-0000-4000-8000-000000000002', user_id: UID, crop_type: 'Tomato', image_urls: [`${UID}/leaf3.jpg`], disease_name: 'Early Blight', confidence_pct: 84, severity: 'medium', status: 'open', created_at: iso(-6 * day), full_report_json: report('Early Blight', 'medium', 84), ai_model: 'gemini-2.5-flash' },
  { id: 'd3000000-0000-4000-8000-000000000003', user_id: UID, crop_type: 'Chilli', image_urls: [], disease_name: 'Healthy', confidence_pct: 95, severity: 'low', status: 'resolved', created_at: iso(-15 * day), full_report_json: report('Healthy', 'low', 95), ai_model: 'qwen/qwen2.5-vl-72b-instruct:free' },
]
const tasks = [
  { id: 't1', crop_cycle_id: crops[0].id, task_name: 'Apply Tricyclazole spray for blast', description: '0.6 g/L, cover both leaf surfaces; avoid spraying before rain.', category: 'pest', priority: 'high', status: 'pending', due_date: dateOnly(0), ai_generated: true, created_at: iso(-1 * day), completed_at: null },
  { id: 't2', crop_cycle_id: crops[0].id, task_name: 'Top-dress urea (2nd split)', description: '25 kg/acre at active tillering; drain field 1 day before.', category: 'fertilization', priority: 'medium', status: 'pending', due_date: dateOnly(3 * day), ai_generated: true, created_at: iso(-1 * day), completed_at: null },
  { id: 't3', crop_cycle_id: crops[1].id, task_name: 'Irrigate chilli — soil moisture low', description: 'Light irrigation in the evening; soil moisture at 17%.', category: 'irrigation', priority: 'high', status: 'pending', due_date: dateOnly(1 * day), ai_generated: true, created_at: iso(-1 * day), completed_at: null },
  { id: 't4', crop_cycle_id: crops[2].id, task_name: 'Stake tomato plants', description: 'Bamboo stakes 1.2 m; tie loosely below first flower cluster.', category: 'other', priority: 'low', status: 'pending', due_date: dateOnly(6 * day), ai_generated: false, created_at: iso(-1 * day), completed_at: null },
  { id: 't5', crop_cycle_id: crops[0].id, task_name: 'Hand weeding between rows', description: 'Remove weeds before they compete for nitrogen.', category: 'weeding', priority: 'medium', status: 'done', due_date: dateOnly(-2 * day), ai_generated: true, created_at: iso(-5 * day), completed_at: iso(-2 * day) },
].map((t) => ({ ...t, title: t.task_name, crop_cycles: { crop_name: crops.find((c) => c.id === t.crop_cycle_id).crop_name, farm_id: crops.find((c) => c.id === t.crop_cycle_id).farm_id, farms: { user_id: UID, name: farms.find((f) => f.id === crops.find((c) => c.id === t.crop_cycle_id).farm_id).name } } }))

const sessions = [
  { id: 's1000000-0000-4000-8000-000000000001', user_id: UID, title: 'Rice blast — how soon should I spray?', created_at: iso(-1 * day) },
  { id: 's2000000-0000-4000-8000-000000000002', user_id: UID, title: 'Best fertiliser schedule for Teja chilli', created_at: iso(-4 * day) },
]
const messages = [
  { id: 'm1', session_id: sessions[0].id, role: 'user', content: 'My rice leaves have grey spots with brown edges. How soon should I spray?', created_at: iso(-1 * day), model: null },
  { id: 'm2', session_id: sessions[0].id, role: 'assistant', model: 'nvidia/nemotron-3-super-120b-a12b:free', created_at: iso(-1 * day + 8000), content: "Ravi garu, those symptoms match **Rice Blast**, which your diagnosis on Green Valley Farm also detected.\n\n⚠️ **Act within 48 hours** — your crop is at the vegetative stage, when blast spreads fastest.\n\n**Spray plan**\n- **Tricyclazole 75% WP** — 0.6 g per litre, ~200 L water per acre\n- Spray in the evening; repeat after 10–12 days\n- Skip spraying if rain is expected within 6 hours\n\n**Also**\n- Hold back extra urea until the disease is controlled\n- Keep 2–3 cm standing water" },
]
const posts = [
  { id: 'p1000000-0000-4000-8000-000000000001', user_id: 'other-user', author_name: 'Lakshmi Reddy', title: 'Yellowing leaves on paddy after transplanting', body: 'Leaves turning yellow from tips about 20 days after transplanting. Soil is clay loam, canal water. Is this nitrogen or zinc deficiency?', crop_tag: 'Rice', tags: ['Rice', 'Nutrients'], image_urls: [], upvotes: 12, created_at: iso(-3 * 3600000) },
  { id: 'p2000000-0000-4000-8000-000000000002', user_id: UID, author_name: 'Ravi Kumar', title: 'Thrips on chilli during flowering — organic options?', body: 'Seeing leaf curl and silvery patches. Want to avoid heavy chemicals before harvest.', crop_tag: 'Chilli', tags: ['Chilli', 'Pests'], image_urls: [], upvotes: 7, created_at: iso(-1 * day) },
  { id: 'p3000000-0000-4000-8000-000000000003', user_id: 'other-user-2', author_name: 'Suresh Naik', title: 'Mandi price for cotton this week in Warangal?', body: 'Anyone sold cotton this week? What rate did you get per quintal?', crop_tag: 'Cotton', tags: ['Cotton', 'Market'], image_urls: [], upvotes: 3, created_at: iso(-2 * day) },
]
const replies = [
  { id: 'r1', post_id: posts[0].id, user_id: null, is_ai: true, author_name: 'AgriDoctor AI', upvotes: 4, created_at: iso(-3 * 3600000 + 30000), content: '- Yellowing from the **tips of older leaves** usually points to **nitrogen** deficiency.\n- **Zinc** deficiency shows as rusty-brown spots on younger leaves, common in clay soils.\n- Next steps: apply 20 kg urea/acre; if spots appear, spray **ZnSO₄ 0.5%**.\n- Recheck in 7 days.' },
  { id: 'r2', post_id: posts[0].id, user_id: UID, is_ai: false, author_name: 'Ravi Kumar', upvotes: 2, created_at: iso(-2 * 3600000), content: 'Had the same last season — zinc sulphate fixed it within a week.' },
]
const notifications = [
  { id: 'n1', user_id: UID, type: 'alert_warning', title: 'Green Valley Farm: Low soil moisture', message: 'Soil moisture is 17%. Consider irrigating within 24h.', metadata: { farm_id: farms[0].id, level: 'warning' }, read_at: null, created_at: iso(-20 * 60000) },
  { id: 'n2', user_id: UID, type: 'alert_warning', title: 'Green Valley Farm: Very high UV', message: 'UV index is 8.6. Use sun protection.', metadata: { farm_id: farms[0].id, level: 'warning' }, read_at: null, created_at: iso(-20 * 60000) },
  { id: 'n3', user_id: UID, type: 'alert_critical', title: 'Green Valley Farm: Extreme heat', message: 'Air temperature is 40.2°C. Increase irrigation and shade susceptible crops.', metadata: { farm_id: farms[0].id, level: 'critical' }, read_at: iso(-1 * day), created_at: iso(-2 * day) },
]
const profile = { id: UID, full_name: 'Ravi Kumar', phone: '+91 98xxxxxx10', state: 'Telangana', district: 'Rangareddy', preferred_language: 'English', alert_preferences: null, created_at: iso(-90 * day) }

const tables = { users: [profile], farms, crop_cycles: crops, crop_tasks: tasks, diagnoses, chat_sessions: sessions, chat_messages: messages, community_posts: posts, community_replies: replies, notifications }

const heat = [
  [17.45, 78.39, 'Rice', 'Rice Blast', 'high', true], [17.47, 78.42, 'Rice', 'Brown Spot', 'medium', false], [17.42, 78.36, 'Rice', 'Rice Blast', 'high', false],
  [17.36, 78.47, 'Tomato', 'Early Blight', 'medium', true], [17.98, 79.59, 'Cotton', 'Pink Bollworm', 'critical', false], [18.0, 79.55, 'Cotton', 'Leaf Curl', 'high', false],
  [16.5, 80.64, 'Rice', 'Sheath Blight', 'medium', false], [15.83, 78.04, 'Groundnut', 'Tikka Leaf Spot', 'low', false], [17.69, 83.22, 'Chilli', 'Thrips damage', 'medium', false],
  [16.3, 80.43, 'Chilli', 'Powdery Mildew', 'low', false], [18.11, 78.85, 'Maize', 'Fall Armyworm', 'critical', false], [17.25, 78.29, 'Rice', 'Rice Blast', 'high', false],
].map(([lat, lng, crop_type, disease_name, severity, is_mine], i) => ({ id: `h${i}-0000-4000-8000-00000000000${i % 10}`, lat, lng, crop_type, disease_name, severity, status: 'open', created_at: iso(-i * 3 * day), is_mine }))

function applyFilters(rows, params) {
  let out = rows
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k) || k.includes('.')) continue
    const [op, ...rest] = v.split('.'); const val = rest.join('.')
    out = out.filter((r) => {
      if (!(k in r)) return true
      const x = r[k]
      if (op === 'eq') return String(x) === val
      if (op === 'neq') return String(x) !== val
      if (op === 'is') return val === 'null' ? x == null : true
      if (op === 'not') return rest[0] === 'is' && rest[1] === 'null' ? x != null : true
      if (op === 'in') return val.replace(/[()"]/g, '').split(',').includes(String(x))
      if (op === 'lte') return x == null || String(x) <= val
      if (op === 'gte') return x == null || String(x) >= val
      return true
    })
  }
  const order = params.get('order')
  if (order) {
    const [col, dir] = order.split(',')[0].split('.')
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1))
  }
  const limit = Number(params.get('limit')); if (limit) out = out.slice(0, limit)
  return out
}

const leafSvg = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${hue},35%,88%)"/><path d="M200 40 C320 110 330 290 200 360 C70 290 80 110 200 40Z" fill="hsl(${hue},55%,38%)"/><path d="M200 50 L200 350" stroke="hsl(${hue},40%,70%)" stroke-width="5"/>${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="${150 + (i % 3) * 45}" cy="${140 + Math.floor(i / 3) * 90}" rx="16" ry="9" fill="#d6cfa8" stroke="#6b4423" stroke-width="4"/>`).join('')}</svg>`


// ─── Mock AI providers (OpenRouter + Gemini wire formats) ────────────────────
const CHAT_ANSWER = "Good question, Ravi garu. For **Teja chilli at flowering** on black cotton soil:\n\n**Fertiliser schedule**\n- **Now (flowering):** 13:0:45 at 5 g per litre as foliar spray, twice 10 days apart\n- **Calcium nitrate** 2 g/L to reduce flower drop\n- Avoid extra urea now — it promotes leaves over flowers\n\n**Irrigation**\n- Your field sensor shows soil moisture at **17%** — irrigate lightly this evening\n\n⚠️ Thrips risk is high in dry, hot weather — inspect leaf undersides every 3 days."
function aiAnswer(bodyText) {
  if (/pathologist/i.test(bodyText)) return JSON.stringify(report('Rice Blast', 'high', 89))
  if (/agronomist/i.test(bodyText)) return JSON.stringify({ tasks: [
    { title: 'Spray Tricyclazole for blast', description: '0.6 g/L in the evening; cover both leaf surfaces.', category: 'pest', priority: 'high', due_offset_days: 0 },
    { title: 'Irrigate — soil moisture low', description: 'Light irrigation; maintain 2–3 cm water.', category: 'irrigation', priority: 'high', due_offset_days: 1 },
    { title: 'Second urea top-dressing', description: '25 kg/acre at active tillering.', category: 'fertilization', priority: 'medium', due_offset_days: 4 },
    { title: 'Scout for stem borer', description: 'Check 10 hills per acre for dead hearts.', category: 'monitoring', priority: 'medium', due_offset_days: 6 },
  ] })
  if (/online and ready/i.test(bodyText)) return 'Online and ready to help Indian farmers with crops, weather and markets.'
  if (/community question/i.test(bodyText)) return '- Likely **nitrogen** deficiency (older leaves yellow first)\n- Apply 20 kg urea/acre\n- If rusty spots appear on young leaves, spray ZnSO₄ 0.5%'
  return CHAT_ANSWER
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function streamSse(res, pieces, fmt) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write(': OPENROUTER PROCESSING\n\n')
  for (const piece of pieces) { res.write(`data: ${fmt(piece)}\n\n`); await sleep(25) }
  res.end('data: [DONE]\n\n')
}
async function handleAi(req, res, p, raw) {
  const body = JSON.parse(raw || '{}')
  await sleep(400) // realistic latency
  const text = aiAnswer(raw)
  const pieces = text.match(/[\s\S]{1,6}/g)
  if (p.startsWith('/ai/openrouter/')) {
    if (process.env.MOCK_FAIL_MODELS?.split(',').includes(body.model)) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"rate limited (mock)"}}') }
    if (body.stream) return streamSse(res, pieces, (t) => JSON.stringify({ choices: [{ delta: { content: t } }] }))
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: text } }] }))
  }
  if (p.includes(':streamGenerateContent')) return streamSse(res, pieces, (t) => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }))
  res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }))
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...headers }); res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) }
  if (req.method === 'OPTIONS') return send(204)
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const p = url.pathname
    if (p.startsWith('/ai/')) return handleAi(req, res, p, raw)
    if (p === '/auth/v1/user') return send(200, user)
    if (p.startsWith('/auth/v1/')) return send(200, {})
    if (p.startsWith('/storage/v1/object/sign/') && req.method === 'POST') {
      const body = JSON.parse(raw || '{}')
      return send(200, (body.paths || []).map((path, i) => ({ path, signedURL: `/object/sign/diagnosis-images/${path}?token=demo${i}`, error: null })))
    }
    if (p.startsWith('/storage/v1/object/sign/')) return send(200, leafSvg(p.includes('leaf3') ? 70 : p.includes('leaf2') ? 95 : 110), { 'Content-Type': 'image/svg+xml' })
    if (p === '/rest/v1/rpc/disease_heatmap') return send(200, heat)
    const m = p.match(/^\/rest\/v1\/([a-z_]+)$/)
    if (!m) return send(404, { message: 'not found' })
    const rows = tables[m[1]] || []
    const accept = req.headers.accept || ''
    if (req.method === 'GET' || req.method === 'HEAD') {
      const out = applyFilters(rows, url.searchParams)
      const headers = { 'Content-Range': `0-${Math.max(0, out.length - 1)}/${out.length}` }
      if (req.method === 'HEAD') return send(200, undefined, headers)
      if (accept.includes('vnd.pgrst.object')) return out[0] ? send(200, out[0], headers) : send(406, { code: 'PGRST116', message: 'no rows' })
      return send(200, out, headers)
    }
    // Writes: echo back a plausible row
    let body = {}; try { body = JSON.parse(raw || '{}') } catch {}
    const mk = (b) => ({ id: require('crypto').randomUUID(), created_at: new Date().toISOString(), ...b })
    const row = Array.isArray(body) ? body.map(mk) : mk(body)
    if (req.method === 'POST' && tables[m[1]]) (Array.isArray(row) ? row : [row]).forEach((r) => tables[m[1]].push(r))
    return send(201, accept.includes('vnd.pgrst.object') && Array.isArray(row) ? row[0] : row)
  })
}).listen(PORT, () => console.log('mock supabase on', PORT))

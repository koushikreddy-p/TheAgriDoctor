// Usage: node shots.cjs <outDir> [pathFilter]
const { chromium, devices } = require('playwright')
const out = process.argv[2]; const filter = process.argv[3]
const BASE = 'http://localhost:3123'
const session = { access_token: 'demo-token', refresh_token: 'demo-refresh', token_type: 'bearer', expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'ravi.kumar@example.com', user_metadata: { full_name: 'Ravi Kumar' }, aud: 'authenticated', role: 'authenticated' } }
const cookie = { name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), domain: 'localhost', path: '/' }
const pages = [
  ['dashboard', '/'], ['diagnose', '/diagnose'], ['diagnose-result', '/diagnose/d1000000-0000-4000-8000-000000000001'], ['diagnose-history', '/diagnose/history'],
  ['heatmap', '/diagnose/heatmap'], ['advisor', '/advisor'], ['farms', '/farms'], ['farm-detail', '/farms/f1000000-0000-4000-8000-000000000001'],
  ['weather', '/weather'], ['market', '/market'], ['community', '/community'], ['community-post', '/community/p1000000-0000-4000-8000-000000000001'],
  ['alerts', '/alerts'], ['alert-settings', '/settings/alerts'], ['profile', '/profile'], ['ai-status', '/ai-status'],
]
;(async () => {
  const b = await chromium.launch()
  const report = []
  for (const mode of ['desktop', 'mobile']) {
    const ctx = await b.newContext(mode === 'desktop' ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { ...devices['iPhone 13'] })
    await ctx.addCookies([cookie])
    for (const [name, path] of pages) {
      if (filter && !name.includes(filter)) continue
      if (mode === 'mobile' && !['dashboard', 'diagnose', 'advisor', 'diagnose-result', 'ai-status'].includes(name)) continue
      const p = await ctx.newPage(); const errs = []
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 150)))
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|tile|rainviewer/i.test(m.text())) errs.push(m.text().slice(0, 150)) })
      const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => null)
      if (name === 'advisor') { await p.locator('text=Rice blast').first().click().catch(() => {}); await p.waitForTimeout(1500) }
      await p.waitForTimeout(1200)
      await p.screenshot({ path: `${out}/${mode}-${name}.png`, fullPage: mode === 'desktop' })
      report.push(`${mode} ${name}: ${r ? r.status() : 'ERR'} ${p.url().replace(BASE, '')} ${errs.length ? 'ERRORS: ' + errs.join(' | ') : ''}`)
      await p.close()
    }
    await ctx.close()
  }
  console.log(report.join('\n')); await b.close()
})()

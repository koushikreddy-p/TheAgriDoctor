// Builds TheAgriDoctor project documentation PDF.
// 1) assemble parts/*.html into one page with Mermaid + highlight.js (local copies)
// 2) print body -> find the page of every heading -> fill TOC page numbers -> print again
// 3) print cover separately (no footer) and merge with pypdf (done by merge.py)
const { chromium } = require('/opt/node-tools/node_modules/playwright')
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const D = __dirname
const TOOLS = process.env.DOCTOOLS || path.join(D, 'node_modules')
const parts = fs.readdirSync(path.join(D, 'parts')).filter((f) => f.endsWith('.html')).sort()
const body = parts.map((f) => fs.readFileSync(path.join(D, 'parts', f), 'utf8')).join('\n')
const css = fs.readFileSync(path.join(D, 'style.css'), 'utf8')
const mermaidJs = fs.readFileSync(path.join(TOOLS, 'mermaid/dist/mermaid.min.js'), 'utf8')
const hljsJs = fs.readFileSync(path.join(TOOLS, '@highlightjs/cdn-assets/highlight.min.js'), 'utf8')
const extra = ['typescript', 'sql', 'bash', 'json'].map((l) => {
  const f = path.join(TOOLS, '@highlightjs/cdn-assets/languages', l + '.min.js')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}).join('\n')

const page = (inner, withScripts) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${inner}
${withScripts ? `<script>${mermaidJs}</script><script>${hljsJs}\n${extra}</script>
<script>
window.__ready = (async () => {
  document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
  mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict',
    themeVariables: { fontFamily: 'Inter, DejaVu Sans, sans-serif', fontSize: '15px', primaryColor: '#EAF4EE', primaryTextColor: '#1B2A22',
      primaryBorderColor: '#2F7A4F', lineColor: '#5B6B61', secondaryColor: '#FFF5DB', tertiaryColor: '#F4F6F3', edgeLabelBackground: '#FFFFFF', clusterBkg: '#F7F9F6', clusterBorder: '#B9C7BD' },
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis', nodeSpacing: 26, rankSpacing: 26, padding: 8, diagramPadding: 6 },
    er: { useMaxWidth: true } });
  await mermaid.run({ querySelector: '.mermaid' });
  // build TOC
  const toc = document.querySelector('#toc-list');
  document.querySelectorAll('h1.chapter, h2[data-toc]').forEach((h, i) => {
    const id = 'h' + i; h.id = id;
    const li = document.createElement('li');
    li.className = h.tagName === 'H1' ? 'l1' : 'l2';
    const label = h.tagName === 'H1' ? (h.querySelector('.num') ? h.querySelector('.num').textContent.replace('Chapter ', '') + '.  ' : '') + h.querySelector('.title').textContent : h.textContent;
    li.innerHTML = '<span class="t"></span><span class="dots"></span><span class="p"></span>';
    li.querySelector('.t').textContent = label;
    li.dataset.key = h.getAttribute('data-key');
    toc.appendChild(li);
  });
  return true;
})();
</script>` : ''}</body></html>`

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext()
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await p.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()))
  await p.setContent(page(body, true), { waitUntil: 'load' })
  await p.evaluate(() => window.__ready)
  const bad = await p.evaluate(() => [...document.querySelectorAll('.mermaid')].filter((m) => !m.querySelector('svg')).map((m) => m.textContent.slice(0, 80)))
  if (bad.length || errors.length) { console.error('RENDER PROBLEMS', bad, errors); process.exit(2) }

  const sizes = await p.evaluate(() => [...document.querySelectorAll('figure.flow')].map((f) => {
    const svg = f.querySelector('svg'); const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect()
    return { cap: (f.querySelector('figcaption')?.textContent || '').slice(0, 40), w: Math.round(vb.width), h: Math.round(vb.height), scale: +(r.width / vb.width).toFixed(2) }
  }))
  if (process.env.SIZES) console.log(JSON.stringify(sizes, null, 0))
  const footer = `<div style="font-family:Inter,sans-serif;font-size:7.5pt;color:#6B7A70;width:100%;padding:0 18mm;display:flex;justify-content:space-between;"><span>TheAgriDoctor — Project Documentation</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
  const pdfOpts = { format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer, margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' } }

  // Pass 1
  await p.pdf({ ...pdfOpts, path: path.join(D, 'body-pass1.pdf') })
  const keys = await p.evaluate(() => [...document.querySelectorAll('h1.chapter, h2[data-toc]')].map((h) => h.getAttribute('data-key')))
  const pagesJson = execFileSync('python3', ['-I', path.join(D, 'find_pages.py'), path.join(D, 'body-pass1.pdf'), JSON.stringify(keys)]).toString()
  const pages = JSON.parse(pagesJson)
  await p.evaluate((pages) => {
    document.querySelectorAll('#toc-list li').forEach((li) => { li.querySelector('.p').textContent = pages[li.dataset.key] ?? '?' })
  }, pages)
  // Pass 2 (TOC length unchanged, so pagination is stable)
  await p.pdf({ ...pdfOpts, path: path.join(D, 'body.pdf') })
  const missing = Object.entries(pages).filter(([, v]) => v == null).map(([k]) => k)
  console.log('headings:', keys.length, 'missing pages:', missing.length ? missing : 'none')

  // Cover
  const cover = fs.readFileSync(path.join(D, 'cover.html'), 'utf8')
  const cp = await ctx.newPage()
  await cp.setContent(page(cover, false), { waitUntil: 'load' })
  await cp.pdf({ path: path.join(D, 'cover.pdf'), width: '210mm', height: '297mm', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } })
  await b.close()
})()

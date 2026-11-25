# Project documentation — source

Source of `docs/TheAgriDoctor_Project_Documentation.pdf`: HTML chapters in `parts/`, flowcharts written in
Mermaid, code highlighted with highlight.js, printed to A4 by Chromium.

```bash
cd docs/documentation-source
npm init -y && npm i mermaid@11.4.1 @highlightjs/cdn-assets@11.10.0   # one time
node build.cjs            # writes cover.pdf + body.pdf (table of contents gets real page numbers)
python3 -c "from pypdf import PdfReader, PdfWriter; w=PdfWriter(); [w.add_page(p) for f in ['cover.pdf','body.pdf'] for p in PdfReader(f).pages]; w.write('../TheAgriDoctor_Project_Documentation.pdf')"
```

Needs Playwright with Chromium, Python with `pypdf`, and the Inter and JetBrains Mono fonts installed.
Edit a chapter in `parts/`, rebuild, and the page numbers in the table of contents update automatically.

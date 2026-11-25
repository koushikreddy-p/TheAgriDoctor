# UI preview with sample data

Runs the real app against a **local mock backend** (fake Supabase + fake AI providers with
sample farm data for one farmer). Use it to review the UI or regenerate screenshots
without any accounts or API keys. Everything shown is **sample data — not a live system**;
do not present it as real usage.

```bash
node scripts/preview/mock-backend.cjs &            # mock Supabase + AI on :54321

export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=demo SUPABASE_SERVICE_ROLE_KEY=mock
export OPENROUTER_API_KEY=mock GEMINI_API_KEY=mock
export OPENROUTER_BASE_URL=http://localhost:54321/ai/openrouter GEMINI_BASE_URL=http://localhost:54321/ai/gemini
npm run build && PORT=3123 npm start &

mkdir -p shots && node scripts/preview/screenshots.cjs shots   # desktop + mobile PNGs of every page
```

Make a mock AI model fail (to show real failover in the logs): start the backend with
`MOCK_FAIL_MODELS=nvidia/nemotron-3-super-120b-a12b:free`.

Requires Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
Weather, radar tiles, satellite images and market prices call real third-party services and
show their "not configured" state in preview.

# TheAgriDoctor — Go-Live Setup Guide

Time needed: about 20 minutes once all accounts exist (OpenWeatherMap keys can take a few hours to activate — create that account first).

> **Never** paste API keys into chat, code, screenshots, or Git. They go only into `.env.local` (your computer) and Vercel's Environment Variables screen.

---

## 1. Create the accounts (all have free tiers)

| # | Service | Sign up | Key you need |
|---|---|---|---|
| 1 | Supabase — database, login, photo storage | https://supabase.com/dashboard | Project URL, publishable (anon) key, secret (service_role) key |
| 2 | OpenRouter — primary AI | https://openrouter.ai/keys | API key |
| 3 | Google AI Studio — Gemini backup AI | https://aistudio.google.com/apikey | API key |
| 4 | OpenWeatherMap — weather page, radar layers | https://home.openweathermap.org/api_keys | API key |
| 5 | Agro Monitoring — satellite NDVI, soil, field data | https://agromonitoring.com | API key (separate from OpenWeatherMap) |
| 6 | data.gov.in — mandi market prices | https://data.gov.in | API key (My Account) |
| 7 | Vercel — hosting | https://vercel.com | Sign in with GitHub |

## 2. Set up the database (Supabase)

1. Supabase → **New project** → choose the **Mumbai (ap-south-1)** region for Indian users → wait for it to start.
2. **SQL Editor → New query** → paste the whole of [`supabase/setup.sql`](../supabase/setup.sql) → **Run**.
3. The result table at the bottom must show `rls_enabled = true` for all 10 tables.
4. **Authentication → URL Configuration** → set **Site URL** to your Vercel address (step 4), e.g. `https://theagridoctor.vercel.app`. This makes sign-up confirmation emails link to the right place.
5. **Project Settings → API Keys** → copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable / `anon` key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret / `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only — never share**)

## 3. Run locally (optional check)

```bash
cp .env.example .env.local      # then fill in every value
npm install
npm test                        # AI pipeline tests — should print 15 PASS
npm run dev                     # open http://localhost:3000
```

## 4. Deploy (Vercel)

1. Vercel → **Add New → Project** → import `TheAgriDoctor` from GitHub.
2. **Environment Variables** → add every variable from `.env.example` with your real values:

   | Variable | Where it's used |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Browser + server |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server (safe to expose; RLS protects data) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server only — AI community replies |
   | `OPENROUTER_API_KEY` | Server only |
   | `GEMINI_API_KEY` | Server only |
   | `OPENWEATHER_API_KEY` | Server only |
   | `AGRO_API_KEY` | Server only |
   | `DATAGOV_API_KEY` | Server only |
   | `NEXT_PUBLIC_SITE_URL` | Optional — your site URL |

3. **Deploy**. Every `git push` redeploys automatically.

## 5. Smoke test after deploy (5 minutes)

- [ ] Sign up → confirm email → log in
- [ ] **Profile**: set name, state, district, language
- [ ] **Farms → New farm** with a location → open it → **Enable monitoring** → weather / soil / NDVI appear
- [ ] **Add crop** → **Generate tasks** (AI) → 4–6 tasks appear
- [ ] **Diagnose**: pick crop, upload a leaf photo → report appears and shows in **History**
- [ ] **Advisor**: ask a question → answer streams word by word; try voice input
- [ ] **Community**: create a post → AI reply appears
- [ ] **Weather**, **Market**, **Heatmap** pages load

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "All AI providers are busy" | OpenRouter free daily limit reached, or keys wrong. Check Vercel logs for lines starting `[ai]` — they list every model tried and why it failed. A free OpenRouter model may have been retired: replace its name in `src/lib/ai.ts` (`TEXT_CHAIN` / `VISION_CHAIN`). |
| Weather page says "not configured" | `OPENWEATHER_API_KEY` missing, or the new key isn't activated yet (can take hours). |
| Field monitoring fails | `AGRO_API_KEY` missing or the free polygon quota is used up. |
| Community posts work but no AI reply | `SUPABASE_SERVICE_ROLE_KEY` not set. |
| Data saves fail / empty pages | `supabase/setup.sql` not run, or run on a different project. |
| "Too many requests" | Built-in per-user rate limit (protects the free AI quota) — wait a minute. |

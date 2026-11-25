# TheAgriDoctor 🌾
### AI-Powered Smart Agriculture & Crop Disease Diagnosis Platform

🚀 Live Demo: https://theagridoctor.vercel.app/

---

## Overview

TheAgriDoctor is a modern AI-powered agriculture platform designed to assist farmers with intelligent crop disease diagnosis, personalized agricultural guidance, weather intelligence, NDVI monitoring, and smart farm management.

The platform combines AI, geospatial technologies, and modern full-stack architecture to provide real-time decision support for farmers.

Built with Next.js 15, Supabase, OpenRouter and Google Gemini AI, OpenWeatherMap, Agro Monitoring and data.gov.in.

---

# Features

## 🌱 AI Crop Disease Diagnosis
- Upload up to 5 crop images
- AI-powered disease detection
- Severity analysis
- Treatment recommendations
- Prevention suggestions
- Yield impact estimation

## 🤖 Personalized AI Farming Advisor
- Real-time streaming AI chat
- Context-aware agricultural assistance
- Voice input support
- Multilingual responses
- Farm-specific recommendations

## 🌦 Weather & NDVI Intelligence
- Real-time weather monitoring
- Soil temperature tracking
- UV index monitoring
- NDVI satellite visualization
- 5-day forecasting

## 🗺 Smart Farm Management
- Multi-farm support
- Crop cycle tracking
- GeoJSON polygon mapping
- Stage-wise crop task generation

## 📊 Community & Alerts
- Farmer discussion platform
- AI-assisted replies
- Smart notifications
- Agricultural alerts
- Diagnosis heatmaps

---

# Tech Stack

- **Frontend:** Next.js 15.5 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, Leaflet maps
- **Backend:** Next.js route handlers (24 API routes), Supabase (PostgreSQL with row-level security, Auth, Storage)
- **AI:** OpenRouter (free NVIDIA, Meta, Google and Alibaba models) with automatic fallback to Google Gemini 2.5 Flash / Flash-Lite
- **Data:** OpenWeatherMap, Agro Monitoring (satellite NDVI, soil), data.gov.in (mandi prices), RainViewer (radar)
- **Hosting:** Vercel + Supabase Cloud

---

# AI Engine — multi-model fallback

Every AI feature goes through one gateway (`src/lib/ai.ts`) that walks an ordered chain until a model answers:

```txt
Text   (advisor, task planner, forum):  Nemotron 3 Super 120B → Llama 3.3 70B → Gemini 2.5 Flash → Gemini 2.5 Flash-Lite
Vision (crop diagnosis):                Gemma 3 27B → Qwen 2.5 VL 72B → Llama 3.2 11B Vision → Gemini 2.5 Flash → Gemini 2.5 Flash-Lite
```

- Time limits per model (30 s; 20 s to first streamed word) and 55 s overall
- Circuit breaker: rate-limited or failing models rest (429: 60 s, 5xx: 20 s, retired: 10 min)
- Structured answers validated; a malformed one is retried on a different model
- Streaming failover on both providers; per-farmer rate limits
- **AI Engine page** (`/ai-status`): live model health, recent requests, and a live failover test with simulated outages

---

# Security

- Row-level security on all 10 tables — each farmer sees only their own data (61 automated attack tests)
- All third-party API keys stay on the server; weather tiles and satellite images are proxied
- Input validation, safe error messages, 0 known dependency vulnerabilities (`npm audit`)

---

# Getting Started

Full go-live guide: **[docs/SETUP.md](docs/SETUP.md)** (accounts, database, environment variables, deploy, smoke test).

```bash
git clone https://github.com/koushikreddy-p/TheAgriDoctor.git
cd TheAgriDoctor
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Database: run [`supabase/setup.sql`](supabase/setup.sql) once in the Supabase SQL editor.

---

# Tests

```bash
npm test                                   # 18 AI pipeline tests (simulated network)
# Database security tests (local PostgreSQL) — see supabase/tests/rls_test.py
```

Preview the UI with sample data and no accounts: [scripts/preview/README.md](scripts/preview/README.md).

---

# Future Improvements

- Scheduled background field scans with SMS / WhatsApp alerts
- Diagnosis accuracy benchmark on a labelled crop-disease dataset
- Offline support and a native mobile app
- IoT soil-sensor integration

---

# Author

## Poreddy Koushik Reddy

Final Year Computer Science Engineering Student  
Full Stack Developer | AI Enthusiast

GitHub: https://github.com/koushikreddy-p

You can Download full document [HERE](https://drive.google.com/uc?export=download&id=1vNIu23TJUaoKOJCpWa4gMY2Y_vItQwga)

---

# Live Demo

🌐 https://theagridoctor.vercel.app/

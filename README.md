# Octane Ajax

Autonomous multi-agent command center for building, launching, and marketing e-commerce products. The UI is a dark **industrial factory floor** where Nova, Forge, and Pixel work through stations while you operate the human **Review Gate** quality checkpoint.

## Project overview

Octane Ajax runs a demo-first pipeline:

| Stage | Station | Actor |
|-------|---------|--------|
| Research | Research Lab | **Nova** — product ideas from trend signals |
| Creation | Design Press | **Forge** — listing assets (simulated) |
| Quality | Review Gate | **You** — approve or reject with feedback |
| Marketing | Media Studio | **Pixel** — schedules promo content after approval |
| Output | Storefront | Published listings (display) |

Every step writes to **factory_events** for the machine log. The factory floor uses **Supabase Realtime** (anon client + RLS) to refresh metrics, agents, and the event feed.

External APIs (Etsy, Printify, TikTok, image LLMs) are **server-side adapter stubs** in `src/lib/ajax/adapters/` — not wired to production yet.

## Architecture

```
Browser (React + Tailwind)
  ├── /login — email/password sign up & sign in
  ├── Pages: /dashboard, /factory, /review, /agents, /settings (auth required)
  ├── useAjaxRealtime → Supabase anon + RLS (postgres_changes)
  └── API calls → Next.js Route Handlers (cookie session)

Next.js App Router
  ├── src/middleware.ts      — session refresh + redirect to /login
  ├── src/app/api/ajax/*     — run-cycle, reset-demo, review, run-pixel, snapshot
  ├── src/lib/ajax/          — domain types, simulators, agent memory
  ├── src/lib/factory/       — snapshot queries
  └── src/lib/supabase/      — client (browser), server (RSC/API)

Supabase Postgres
  ├── Tables: agents, tasks, ideas, listings, review_queue, feedback, events, content_jobs
  ├── RLS: user-scoped rows (user_id = auth.uid()); shared ajax_agents for demo
  └── Realtime publication on pipeline tables
```

**Security model**

- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the browser.
- `SUPABASE_SERVICE_ROLE_KEY` and integration secrets are **server-only** (see `.env.example`).
- `createServiceClient()` exists in `src/lib/supabase/server.ts` but is **not** exported from the browser barrel and is **not** used by current API routes (all use session-scoped `createClient()`).

## Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project

### Install and run

```bash
cd Projects/octane-ajax
npm install
cp .env.example .env.local
# Edit .env.local with your Supabase URL + anon key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and go to **Sign in** (`/login`).

## Local demo setup

Follow these steps to run the full pipeline on your machine.

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. Open **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Configure the app

```bash
cp .env.example .env.local
```

Edit `.env.local` with your URL and anon key. You do **not** need the service role key for the demo.

### 3. Apply migrations

Run both SQL files in **SQL Editor** (or use `supabase db push`):

- `supabase/migrations/20260516120000_init_octane_ajax_schema.sql`
- `supabase/migrations/20260516130000_realtime_pipeline_tables.sql`

### 4. Enable email/password auth

In the Supabase dashboard:

1. **Authentication → Providers → Email** — ensure Email is enabled.
2. For the smoothest local demo, turn **off** “Confirm email” (or confirm users manually). Otherwise sign-up requires clicking a confirmation link before sign-in works.

### 5. Run the app

```bash
npm run dev
```

### 6. Create your demo operator

1. Open [http://localhost:3000/login](http://localhost:3000/login).
2. Use **Sign up** with any email/password (min 6 characters).
3. You should land on `/factory` when signed in.

Check **Settings** (`/settings`) for env status, signed-in email, and user id.

### 7. Run the demo workflow

| Step | Where | Action |
|------|--------|--------|
| 1 | `/factory` | **Reset factory** |
| 2 | `/factory` | **Run Ajax cycle** (Nova → Forge → stops at Review Gate) |
| 3 | `/review` | Open pending listing |
| 4 | `/review` | **Approve** |
| 5 | `/factory` | **Run Pixel** |
| 6 | `/factory` | Confirm metrics, machine log, and agent sprites updated |

Optional: reject a listing to populate **Agents** memory, then approve another and run Pixel again.

**Sign out** from the header on any command page.

### Verify Supabase before the UI demo

With `.env.local` filled in, run:

```bash
npm run check:demo
```

This checks: env vars, all 8 pipeline tables exist, Nova/Forge/Pixel seeds, email auth, and an authenticated RLS insert. If it fails with **“Could not find the table”**, apply the migrations below first.

## Troubleshooting (local demo)

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `check:demo` — table does not exist | Migrations not applied | Run both SQL files in Supabase **SQL Editor** (project ref from your URL, e.g. `znhvutqoghugbzpkjale`) |
| Sign up works but sign-in fails | Email confirmation required | Supabase → **Authentication → Providers → Email** → disable **Confirm email**, or confirm user in **Authentication → Users** |
| `check:demo` auth rate limit | Too many test signups from automation | Wait ~1 hour, or sign up once at `/login`; optional `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for seed-only checks |
| `check:demo` table missing | Migrations not on this project | Run `supabase link --project-ref <ref>` then `supabase db push` |
| `/factory` redirects to `/login` immediately | No session cookie | Sign in at `/login`; check browser allows cookies for `localhost` |
| API returns **401 Unauthorized** | Session not sent to API | Hard refresh after login; ensure you use the same origin (`localhost:3000`) |
| **409** on Run Ajax cycle | Pending review exists | Approve or reject at `/review`, or **Reset factory** |
| **409** on Run Pixel | No approved listing / content queue | Approve a listing first, then run Pixel |
| Realtime stuck on “connecting” | Realtime not enabled or not signed in | Apply migration `20260516130000_*`; sign in; check **Database → Publications → supabase_realtime** includes pipeline tables |
| Build logs `Dynamic server usage` for `/dashboard` | Expected without `force-dynamic` | Command layout sets `dynamic = "force-dynamic"` — safe to ignore if build succeeds |

**API routes used by the UI**

| UI control | Method | Route |
|------------|--------|--------|
| Reset factory | POST | `/api/ajax/reset-demo` |
| Run Ajax cycle | POST | `/api/ajax/run-cycle` |
| Approve | POST | `/api/ajax/review/approve` |
| Reject | POST | `/api/ajax/review/reject` |
| Run Pixel | POST | `/api/ajax/run-pixel` |
| Snapshot refresh / Realtime | GET | `/api/ajax/factory-snapshot` |

## Supabase migrations

Apply both migrations in order:

1. `supabase/migrations/20260516120000_init_octane_ajax_schema.sql` — tables, **RLS enabled on all tables**, policies, seed Nova/Forge/Pixel
2. `supabase/migrations/20260516130000_realtime_pipeline_tables.sql` — Realtime for factory tables

**CLI (recommended)**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Dashboard**

Paste each file into **SQL Editor** and run in order.

Regenerate TypeScript types after schema changes:

```bash
supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | Anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Optional admin bypass (not used by default routes) |
| `ETSY_*`, `PRINTIFY_*`, `TIKTOK_*`, `IMAGE_GENERATOR_*` | Server only | Future adapter integrations |

Copy `.env.example` → `.env.local`. Never prefix integration secrets with `NEXT_PUBLIC_`.

## Demo workflow

End-to-end path (requires Supabase configured + signed in):

1. **Reset factory** — `/factory` → **Reset factory** (`POST /api/ajax/reset-demo`) clears your user’s pipeline rows and idles agents.
2. **Run Ajax cycle** — **Run Ajax cycle** (`POST /api/ajax/run-cycle`): Nova creates ideas → Forge creates a listing → pipeline **pauses at Review Gate** (409 if a review is already pending).
3. **View pending review** — `/review` or factory metrics **QC pending**; listing appears in the review queue.
4. **Approve listing** — **Approve** (`POST /api/ajax/review/approve`): listing approved, feedback stored, Pixel path unlocked.
5. **Run Pixel** — `/factory` → **Run Pixel** (`POST /api/ajax/run-pixel`): content job scheduled, listing moves toward published.
6. **See updated state** — factory floor, machine log, and metrics update via Realtime + snapshot (`GET /api/ajax/factory-snapshot`).

Also try **Reject** on `/review` to feed **agent memory** (`/agents`).

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/dashboard` | Command center telemetry |
| `/factory` | Live floor, controls, machine log |
| `/review` | Human quality control queue |
| `/agents` | Agent memory from approvals/rejections |
| `/login` | Sign up / sign in (email + password) |
| `/settings` | Env, session status, next steps |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build + TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | Security smoke + domain + demo wiring tests |
| `npm run check:security` | Client secret scan + RLS migration check |
| `npm run check:demo` | Live Supabase schema + auth + RLS probe (needs `.env.local`) |

## Project layout

```
src/
  app/
    (command)/          # App shell: dashboard, factory, review, agents, settings
    api/ajax/           # Demo pipeline APIs
  components/
    factory/            # Floor map, controls, sprites, event feed
    review/             # Review cards, reject modal
    agents/             # Memory cards
    layout/             # factory-shell, command-header
  hooks/
    useAjaxRealtime.ts
  lib/
    ajax/               # constants, simulators, adapters, agent-memory
    factory/            # snapshot queries
    review/             # review service
    supabase/           # client, server, types, schema
supabase/migrations/
tests/                  # security + demo wiring smoke tests
```

## Phase 2 architecture (foundation — not wired to Nova yet)

Phase 2 adds deterministic foundations beside the existing demo simulators. **Nova, Forge, and Pixel still use the simulated pipeline** until a deliberate wiring step; `POST /api/ajax/run-cycle` does not call the LLM layer.

| Lane | Location | Status |
|------|----------|--------|
| Product Brain | `src/lib/ajax/product-brain/` | Rules + scoring + verdicts (tested) |
| Product data model | `src/lib/product/domain.ts`, `mappers.ts`, migration `20260517140000_phase2_product_generation.sql` | Brain columns on `product_ideas`, `product_generations` table, RLS |
| LLM foundation | `src/lib/llm/` (`openai.ts`, `json.ts`, `cost.ts`) | Server-only OpenAI wrapper, `completeJson` + Zod, retries, cost stubs — **not** imported by run-cycle |
| PDF prototype | `src/lib/product/pdf-generator.ts` | `pdf-lib` printable from `ProductDocument` — **not** connected to Forge/storage yet |
| Review upgrades | `/review` UI | Brain scores, compliance warnings, structure/PDF placeholders (mock-friendly) |

**Product Brain** scores and filters ideas before any future LLM generation:

- Validates category eligibility and blocked claims (medical, legal, financial, trademark, guaranteed results, government impersonation)
- Scores specificity, buyer clarity, usefulness, and competition/compliance risk
- Returns a verdict: `approve_for_generation`, `needs_revision`, or `blocked`
- Snapshots can persist on `product_ideas` (`brain_score`, `brain_validation`, `brain_verdict`, `brain_evaluated_at`) via `src/lib/product/mappers.ts`

**Security:** only `NEXT_PUBLIC_SUPABASE_*` in the browser. `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and adapter secrets stay server-only (`tests/security.test.mjs` scans client components and migrations for RLS).

The human **Review Gate** remains mandatory — no live publishing without approval.

## Future integrations

- **Etsy** — `lib/ajax/adapters/etsy.ts` draft/publish listings
- **Printify** — POD product creation
- **TikTok** — short-form content posting
- **Image generator** — mockups via OpenAI/Gemini/etc.
- **LLM agents** — replace deterministic simulators; inject `agent-memory` prompt bundles
- **Storefront** — public published catalog view

## Learn more

- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)

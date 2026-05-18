# Octane Ajax

Autonomous multi-agent command center for building, launching, and marketing e-commerce products. The UI is a dark **industrial factory floor** where Nova, Forge, and Pixel work through stations while you operate the human **Review Gate** quality checkpoint.

## Project overview

Octane Ajax runs a demo-first pipeline:

| Stage | Station | Actor |
|-------|---------|--------|
| Research | Research Lab | **Nova** — product ideas from trend signals |
| Creation | Design Press | **Forge** — listing + product structure (LLM when configured) |
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
- `supabase/migrations/20260517140000_phase2_product_generation.sql`
- `supabase/migrations/20260518120000_product_pdfs_storage.sql`
- `supabase/migrations/20260518140000_content_jobs_metadata.sql`

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
| 4 | `/review` | **Approve** — runs Pixel automatically and publishes to the **demo storefront** (not Etsy) |
| 5 | `/store` | Confirm the listing appears (status `published`) |
| 6 | `/factory` | Confirm metrics, machine log, and agent sprites updated |

Optional: **Run Pixel** on `/factory` retries any still-queued jobs. Reject a listing to populate **Agents** memory, then approve another.

**Sign out** from the header on any command page.

### Verify Supabase before the UI demo

With `.env.local` filled in, run:

```bash
npm run check:demo
```

This always checks env vars and all 8 pipeline tables. Without `DEMO_TEST_EMAIL` / `DEMO_TEST_PASSWORD` in `.env.local`, it skips live auth and still passes when schema is OK (with warnings). With those vars set to an **existing** Supabase test user, it also verifies sign-in, Nova/Forge/Pixel seeds, and an authenticated RLS insert. For the full UI demo, sign up or sign in at **`/login`** (main manual path). If it fails with **“Could not find the table”**, apply the migrations below first.

## Troubleshooting (local demo)

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `check:demo` — table does not exist | Migrations not applied | Run both SQL files in Supabase **SQL Editor** (project ref from your URL, e.g. `znhvutqoghugbzpkjale`) |
| Sign up works but sign-in fails | Email confirmation required | Supabase → **Authentication → Providers → Email** → disable **Confirm email**, or confirm user in **Authentication → Users** |
| `check:demo` skips auth (WARN) | `DEMO_TEST_EMAIL` / `DEMO_TEST_PASSWORD` not set | Normal for schema-only check; add both for full auth + RLS probe, or use `/login` for manual demo |
| `check:demo` auth fails | Bad credentials or email confirmation | Create user at `/login`, then set `DEMO_TEST_EMAIL` / `DEMO_TEST_PASSWORD`; disable **Confirm email** or confirm user in Supabase |
| `check:demo` auth rate limit | Too many auth attempts | Wait ~1 hour; optional `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for seed-only checks when live auth is skipped |
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
| Download PDF (Review) | GET | `/api/ajax/product-generations/:id/pdf-download` |

## Supabase migrations

Apply both migrations in order:

1. `supabase/migrations/20260516120000_init_octane_ajax_schema.sql` — tables, **RLS enabled on all tables**, policies, seed Nova/Forge/Pixel
2. `supabase/migrations/20260516130000_realtime_pipeline_tables.sql` — Realtime for factory tables
3. `supabase/migrations/20260517140000_phase2_product_generation.sql` — Product Brain columns, `product_generations`, RLS
4. `supabase/migrations/20260518120000_product_pdfs_storage.sql` — private `product_pdfs` bucket + user-scoped storage policies
5. `supabase/migrations/20260518140000_content_jobs_metadata.sql` — `content_jobs.metadata` jsonb for Pixel promo packages

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
| `DEMO_TEST_EMAIL` / `DEMO_TEST_PASSWORD` | Scripts only | Optional — `npm run check:demo` live auth + RLS (existing test user) |
| `OPENAI_API_KEY` | Server only | Optional — enables Nova LLM ideation (see below) |
| `ETSY_*`, `PRINTIFY_*`, `TIKTOK_*`, `IMAGE_GENERATOR_*` | Server only | Future adapter integrations |

Copy `.env.example` → `.env.local`. Never prefix integration secrets with `NEXT_PUBLIC_`.

## Demo workflow

End-to-end path (requires Supabase configured + signed in):

1. **Reset factory** — `/factory` → **Reset factory** (`POST /api/ajax/reset-demo`) clears your user’s pipeline rows and idles agents.
2. **Run Ajax cycle** — **Run Ajax cycle** (`POST /api/ajax/run-cycle`): Nova creates ideas → Forge creates a listing → pipeline **pauses at Review Gate** (409 if a review is already pending).
3. **View pending review** — `/review` or factory metrics **QC pending**; listing appears in the review queue.
4. **Approve listing** — **Approve** (`POST /api/ajax/review/approve`): listing `approved`, Pixel runs inline, content job `scheduled`, listing **`published` on the demo storefront** (not Etsy).
5. **Optional retry** — `/factory` → **Run Pixel** (`POST /api/ajax/run-pixel`) only if a job is still `queued` (e.g. partial failure).
6. **See updated state** — `/store`, factory floor, machine log, and metrics update via Realtime + snapshot (`GET /api/ajax/factory-snapshot`).

Also try **Reject** on `/review` to feed **agent memory** (`/agents`).

## Storefront prototype (demo)

The internal storefront at **`/store`** (command layout, auth required) lists **approved** and **published** listings via `fetchStoreListings` in `src/lib/store/queries.ts`. Detail pages live at `/store/[listingId]`.

| Surface | What it shows |
|---------|----------------|
| `/store` | Operator catalog — title, price, tags, brain snapshot, generation status |
| Factory metrics | **Published** count from `fetchFactorySnapshot` (`src/lib/factory/queries.ts`) |
| Dashboard | Same `publishedListings` telemetry |
| Pixel copy | Promo captions reference the **demo storefront** (no external marketplace) |

Listings reach the storefront only after human approval (`approved` or `published`). There is no public anonymous catalog or payment checkout in this repo yet.

## Publish flow (listing lifecycle)

Listing status transitions are defined in `src/lib/ajax/status.ts`:

```
draft → pending_review → approved → published
              └→ rejected
```

| Step | Actor | DB effect |
|------|--------|-----------|
| Forge cycle | Simulator | Listing `pending_review`, review queue `pending` |
| Human approve | Review service → Pixel simulator | Listing `approved` → job `scheduled` → listing **`published`** (demo storefront) |
| Run Pixel (retry) | Pixel simulator | Re-processes any remaining `queued` jobs; same schedule + publish behavior |

**Guards:** `run-cycle` does not invoke Pixel or publish (`simulator.ts` pauses at Review Gate). Rejected listings cannot reach `published`. Blocked Product Brain verdicts cannot be approved server-side.

## Sellability checklist (Review Gate)

Before approving, inspect the printable asset on `/review`. `buildSellabilityChecklist()` in `src/lib/review/sellability.ts` evaluates:

| Check ID | Meaning |
|----------|---------|
| `min_six_pages` | At least 6 pages (aligned with `FORGE_MIN_PAGES`) |
| `cover_page` / `instructions_page` / `worksheet_pages` / `summary_page` | Required page roles |
| `ai_disclosure` | Disclosure text present |
| `no_compliance_warnings` | No blocking compliance flags (AI disclosure excluded) |
| `pdf_ready` | Generation `ready` with storage path (skipped in mock mode) |

`isSellableStructure()` in `src/lib/product/structure-to-document.ts` is the lightweight page-count helper used in the PDF panel UI.

## Pixel marketing package (demo)

`POST /api/ajax/run-pixel` runs `runPixelMarketing` in `src/lib/ajax/pixel-simulator.ts`. Promo copy is built in `src/lib/ajax/pixel-promo-package.ts` (`buildPixelPromoPackage`). For each queued `content_jobs` row it:

1. Builds a **promo package** — short/long captions, Pinterest fields, TikTok hooks, hashtags, `demo://` asset URL, `scheduled_for` (~48h)
2. Updates the job to `scheduled` via `buildContentJobScheduleUpdate` (persists full promo package in `content_jobs.metadata` when migration `20260518140000_*` is applied; see `CONTENT_JOBS_HAS_METADATA_COLUMN`)
3. Sets the linked listing to **`published`** (demo storefront only)
4. Logs `content_scheduled` factory events with `marketing`, `assetUrl`, `scheduledFor` metadata

No TikTok/Etsy APIs are called; swap `buildPixelPromoPackage` for LLM or platform adapters later.

## Payment & Etsy (future)

| Integration | Status | Notes |
|-------------|--------|-------|
| **Etsy** | Stub only | `src/lib/ajax/adapters/etsy.ts` — draft/publish simulated server-side; wire from API routes after Review Gate |
| **Stripe** | Not in repo | No checkout keys or client SDK; add server-only checkout when storefront monetization is ready |
| **Printify / TikTok** | Stubs | `src/lib/ajax/adapters/` — same server-only pattern |

**Security:** client bundles must not import adapters, Stripe, OpenAI, or service-role Supabase (`tests/security.test.mjs`).

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
| `/store` | Internal storefront — approved & published listings |
| `/store/[listingId]` | Storefront listing detail |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build + TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | Security, publish/storefront wiring, Product Brain, Forge/Nova, PDF, sellability, factory queries |
| `npm run check:security` | Client secret scan + RLS migration check |
| `npm run check:demo` | Live Supabase schema probe (`.env.local`); optional `DEMO_TEST_*` for auth + RLS |

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
    ajax/               # constants, simulators, nova/, forge/, adapters
    factory/            # snapshot queries
    review/             # review service
    supabase/           # client, server, types, schema
supabase/migrations/
tests/                  # security, demo workflow, pixel marketing, storefront wiring
```

## Nova ideation: LLM mode vs fallback demo mode

`POST /api/ajax/run-cycle` runs **Nova → Forge → Review Gate**. **Nova** and **Forge** may call the LLM layer (via `src/lib/ajax/nova/` and `src/lib/ajax/forge/`). **Pixel** stays deterministic/simulated. The simulator imports agent modules only — never `@/lib/llm` directly.

| Mode | When | Behavior |
|------|------|----------|
| **LLM** | `OPENAI_API_KEY` set on the server and the OpenAI call succeeds | Nova uses `completeJson` + Zod (`src/lib/ajax/nova/`) to propose utility-first digital download ideas |
| **Fallback** | Key missing, API error, or every LLM idea blocked by Product Brain | Reuses the original deterministic demo catalog (`buildFakeProductIdeas`) |

**Product Brain gates every idea before it hits the pipeline:**

1. Each raw idea is scored and validated (`scoreProductIdea`, `validateProductIdea`, `getProductBrainVerdict`).
2. `blocked` → not inserted into `product_ideas`.
3. `approve_for_generation` → preferred for Forge selection.
4. `needs_revision` → may be saved with a lower `trend_score` penalty; `brain_verdict` and snapshots persist via `src/lib/product/mappers.ts`.

**Forge selection:** among saved ideas, Forge picks `approve_for_generation` first (highest `trend_score` / brain total), then `needs_revision` if none approved.

Set `OPENAI_API_KEY` in `.env.local` (server only — never `NEXT_PUBLIC_*`) to try LLM mode for Nova and Forge. Omit it to run the deterministic fallback path for both.

## Forge generation: LLM mode vs fallback

| Mode | When | Behavior |
|------|------|----------|
| **LLM** | `OPENAI_API_KEY` set and OpenAI call succeeds | Forge uses `completeJson` + Zod (`src/lib/ajax/forge/`) for listing copy, exactly **13** SEO tags, printable page structure, compliance notes, and AI disclosure |
| **Fallback** | Key missing or API/validation failure | Deterministic listing from the selected idea, **$24.99** price, **8-page** sellable structure (cover, instructions, worksheets, summary), padded SEO tags |

**Persisted artifacts**

- `product_listings` — title, description, price (`pending_review`, platform `demo`)
- `product_generations` — `structure` (pages with `userInstructions`), `compliance_flags` / `compliance_warnings`, LLM metadata, `generation_status` (`pending` → `generating` → `ready` or `failed`), `pdf_storage_path`
- `ajax_tasks.output` — `seoTags`, `generationId`, `forgeMode`, `aiDisclosure`, etc.

**AI disclosure** (required in listing copy and stored on the generation):

> AI tools assisted in drafting and structuring this digital product. The seller reviewed and customized the final product.

**PDF flow (Milestone 2.5):** After Forge persists `product_generations`, `pdf-service` maps structure → `pdf-generator` → uploads to private Supabase Storage bucket `product_pdfs` at `{user_id}/{generation_id}.pdf`. Review uses `GET /api/ajax/product-generations/:id/pdf-download` (session auth + ownership) to redirect to a short-lived signed URL. If upload fails, the cycle still pauses at Review Gate (`generation_status: failed`, factory event `pdf_generation_failed`). **Etsy** remains a future draft-only adapter — no live publish; Review Gate is mandatory. No Stripe in this repo.

### PDF quality standard

Sellable utility printables target **6–12 pages** with:

- **Cover** — title, audience, format
- **Instructions** — how to print and use the pack
- **Worksheets** — tables, checklists, and fillable fields (at least two worksheet pages)
- **Summary / review** — reflection and close-out

Forge Zod validation enforces this for LLM output (`forge-generation-v2`). The PDF renderer adds page numbers, a light footer line, and a **single AI disclosure** on the final page (not repeated on every page). Thinner legacy structures (2–3 pages) still render for backwards compatibility but are flagged in Review.

**Human review is required** before any future storefront or payment integration — no auto-publish.

### Product PDF storage setup

1. Apply migration `20260518120000_product_pdfs_storage.sql` (SQL Editor or `supabase db push`).
2. If bucket creation fails in SQL, run `node scripts/setup-product-pdfs-bucket.mjs` with `SUPABASE_SERVICE_ROLE_KEY` set, then re-apply the migration for RLS policies.
3. Optional: set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for server PDF uploads (signed URLs and uploads use the service client in `pdf-storage.ts`).

## Phase 2 architecture

| Lane | Location | Status |
|------|----------|--------|
| Nova ideation | `src/lib/ajax/nova/` | LLM when configured + Product Brain gate; deterministic fallback |
| Product Brain | `src/lib/ajax/product-brain/` | Rules + scoring + verdicts (tested) |
| Product data model | `src/lib/product/domain.ts`, `mappers.ts`, migration `20260517140000_phase2_product_generation.sql` | Brain columns on `product_ideas`, `product_generations` table, RLS |
| LLM foundation | `src/lib/llm/` | Server-only OpenAI wrapper — used by Nova and Forge services |
| Forge generation | `src/lib/ajax/forge/` | LLM when configured + Zod; deterministic fallback |
| Pixel | `src/lib/ajax/pixel-simulator.ts` | Simulated media (no LLM) |
| PDF pipeline | `src/lib/product/pdf-generator.ts`, `pdf-service.ts`, `pdf-storage.ts` | Forge cycle generates + uploads; Review downloads via signed URL |
| Review upgrades | `/review` UI | Brain scores, compliance warnings, structure/PDF placeholders |

**Security:** only `NEXT_PUBLIC_SUPABASE_*` in the browser. `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and adapter secrets stay server-only (`tests/security.test.mjs` scans client components; `simulator.ts` imports Nova and Forge, not `@/lib/llm` directly).

The human **Review Gate** remains mandatory — no live publishing without approval.

## Future integrations

- **Etsy** — `lib/ajax/adapters/etsy.ts` draft/publish listings
- **Printify** — POD product creation
- **TikTok** — short-form content posting
- **Image generator** — mockups via OpenAI/Gemini/etc.
- **LLM agents** — replace deterministic simulators; inject `agent-memory` prompt bundles
- **Storefront** — public `/store` catalog (see [Storefront prototype](#storefront-prototype-demo))
- **Stripe checkout** — server-only payment links on published listings (see [Payment & Etsy](#payment--etsy-future))

## Learn more

- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)

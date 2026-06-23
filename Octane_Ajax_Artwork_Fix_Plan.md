# Octane Ajax — Artwork / POD Fulfillment Fix Plan

**Scope:** Fix the bug that leaves listings stuck at `generation_status: 'generating'` so a Printify draft can actually become "ready" at the Review Gate. This is the gap Manus's "To The Moon" audit missed (it assumed `after()` was sufficient). It is the true blocker to producing a finished product.

**Status of related cleanups (already done in the database):**
- Stuck "Mountain Biker Mug" generation reset `generating → failed` (gate unfrozen).
- Retired "Family Activity Organizer" digital download set `published → rejected` (off `/store`).

---

## 1. Root cause (confirmed from live event data)

The last cycle ran correctly on OpenAI (`ideationMode: llm`, `gpt-4o-mini`), then logged `pod_fulfillment_triggered` and set the generation to `generating` — and **then went silent**. No `pod_fulfillment_ready`, no `pod_fulfillment_failed`, no `pod_fulfillment_trigger_failed`.

That silence is the tell. The fulfillment runs in a fire-and-forget `after()` task (`schedulePodFulfillmentAfterForge` in `src/lib/product/generation-pod-runner.ts`). On Vercel, `after()` survives the *response* being sent, but it **still runs inside the Forge request's function lifetime** (`export const maxDuration = 60` in `src/app/api/ajax/run-forge/route.ts`).

The chain inside `runPodFulfillment` (`src/lib/ajax/pod/fulfillment-runner.ts`) is:

1. `imageGeneratorAdapter.generateProductArtwork()` → **live `gpt-image-1`** now that `OPENAI_API_KEY` is set (was an instant demo placeholder before). This single call is ~15–40s.
2. `printifyAdapter.uploadArtwork()`
3. `printifyAdapter.createProduct()`

When Forge's own LLM text-gen + the image call exceed ~60s, **Vercel tears the function down mid-`await`** — so neither the success path (`ready`) nor the `catch` (`failed`) ever runs. The row is orphaned at `generating`, which is exactly what the Review Gate shows ("Printify draft ready ✗ — POD fulfillment still running").

**Compounding issues:**
- **Permanent wedge:** `runGenerationPodJob` throws `409 "already in progress"` for anything in `generating`, so a torn-down job can never be retried.
- **base64, not a URL:** `gpt-image-1` returns `b64_json`; `image-generator.ts` stores the whole image as a multi-MB `data:` URI in `mockup_storage_path`. Heavy in the DB, and Printify-live prefers an `http(s)` URL.
- **No timeout guard:** neither the OpenAI image call nor the Printify `fetch`es have a hard timeout, so they can hang until the platform kills them.

---

## 2. Design

Decouple artwork generation from the cycle request, give it its own budget, make it fail fast and clean, and make it retryable.

1. **Dedicated fulfillment route** the Review UI (and cron) call, with its own `maxDuration`. The image call no longer shares Forge's 60s budget.
2. **Hard timeout** on the OpenAI image call (and Printify calls) below the function budget, so a slow call records `failed` instead of being killed silently.
3. **Persist artwork to Supabase Storage** and store a public `https` URL — not a `data:` URI. The Review UI can render it and Printify-live can ingest it by URL.
4. **Retryable `generating`:** treat a `generating` row whose `updated_at` is older than a staleness window as retryable instead of throwing 409.
5. **Review Gate stays intact** — still draft-only, still human-approved. No PDF logic reintroduced. RLS unchanged.

---

## 3. File-by-file changes

### 3.1 New: public Storage bucket + helper
- **Migration** `supabase/migrations/<ts>_product_artwork_bucket.sql`: create a **public** bucket `product-artwork`; policy: public `select`, authenticated `insert` scoped to `auth.uid()` path prefix.
- **New** `src/lib/product/artwork-storage.ts`:
  ```ts
  export async function uploadProductArtwork(args: {
    supabase: Supabase; userId: string; generationId: string;
    base64: string; mimeType?: string;
  }): Promise<{ publicUrl: string; storagePath: string }>
  ```
  Decodes base64 → `supabase.storage.from('product-artwork').upload(`${userId}/${generationId}.png`, bytes, { upsert: true })` → returns `getPublicUrl(...)`.

### 3.2 `src/lib/ajax/adapters/image-generator.ts`
- Construct the client with a hard timeout + no retries: `new OpenAI({ apiKey, timeout: IMAGE_GENERATION_TIMEOUT_MS, maxRetries: 0 })` (default **45000ms**, below the 60s function cap).
- Have `generateProductArtwork` return the raw `{ imageBase64, mimeType }` in addition to `imageUrl`, so the runner can persist bytes to Storage. (Keep `imageUrl` populated for existing tests/back-compat.)

### 3.3 `src/lib/ajax/pod/fulfillment-runner.ts`
- After artwork generation, **persist to Storage** (via a `persistArtwork` callback passed in by the runner) and use the returned **public URL** for `printifyAdapter.uploadArtwork({ imageUrl })` and for the stored `fulfillment.artworkUrl`.
- Add an `AbortController` timeout around the Printify `fetch` calls (upload/create) so they can't hang.

### 3.4 `src/lib/product/generation-pod-runner.ts`
- **Relax the guard:** allow re-run when `generationStatus === 'generating'` **and** `updated_at` is older than `STALE_FULFILLMENT_MS` (e.g. 90s); otherwise keep the 409.
- Pass a `persistArtwork` closure (bound to `supabase`, `userId`, `generationId`) into `runPodFulfillment`.
- On `ready`: also update `product_listings.mockup_url` with the public artwork URL so the Review UI renders the image.
- Keep the existing `ready`/`failed` event + status writes (already correct).

### 3.5 New: `src/app/api/ajax/product-generations/[id]/fulfill/route.ts`
- `export const maxDuration = 300;` (Pro plan; on Hobby this is capped at 60 — but the image call now gets the **full** budget instead of sharing it with Forge).
- `POST`: auth → `runGenerationPodJob(supabase, user.id, id)` → `{ ok, status, fulfillment }`.
- `GET`: return `{ generationStatus, mockupUrl }` for polling. (Or reuse an existing generation-status read if present.)

### 3.6 `src/lib/ajax/simulator.ts` (`executeForgeStep`)
- Generation is still created with `generationStatus: 'queued'`.
- **Interactive path:** remove the `schedulePodFulfillmentAfterForge(...)` `after()` call; the Review UI triggers `/fulfill` (below). This is what makes it reliable on serverless.
- **Automated/cron path** (`src/app/api/cron/run-nova/route.ts`): after Forge, `await runGenerationPodJob(...)` directly (cron can run longer and has no client to poll).

### 3.7 Review UI
- `src/components/review/review-dashboard.tsx` (client): on load, if the top item's generation is `queued` or stale `generating`, `POST /fulfill` once, then poll `GET` status every ~3s until `ready`/`failed`. Add a manual **"Generate / Retry artwork"** button.
- `src/components/review/review-phase2-section.tsx`: render the artwork from `mockup_url` when `ready`; show `Generating… / Failed → Retry` states. (This is where today's "Product Assets: GENERATING" lives.)

### 3.8 Env / ops
- `OPENAI_API_KEY` ✅ (set). **Verify the OpenAI org is verified for image generation** — `gpt-4o-mini` working does not guarantee `gpt-image-1` access, and a 403 there would otherwise look like a hang.
- Optional `IMAGE_GENERATION_TIMEOUT_MS` (default 45000).
- `PRINTIFY_API_TOKEN` + `PRINTIFY_SHOP_ID` for live Printify (otherwise stays demo — fine for testing).
- Note the Vercel plan re: `maxDuration` (300 needs Pro).

---

## 4. Tests / verification (per AGENTS.md)
- Update `tests/demo-workflow.test.mjs` for the queued→fulfill→ready flow.
- Add: `artwork-storage` unit test, a `/fulfill` route test, and a stale-`generating` retry test.
- Run `npm run lint`, `npm run test`, `npm run build` — keep the suite green.

## 5. Acceptance check
Run one cycle → a `pod_fulfillment_ready` event fires within the budget, `product_generations.generation_status = 'ready'`, `mockup_url` holds a real `https` Storage URL, and the Review Gate shows the artwork with approval unblocked (still draft-only).

---

## 6. Ready-to-paste Cursor prompt

```text
Project: Octane Ajax
Task: Fix the POD artwork/fulfillment pipeline so listings stop getting stuck at generation_status='generating'

Root cause: artwork (gpt-image-1) runs in an after() task sharing run-forge's 60s budget; it overruns and Vercel tears the function down mid-await, so neither 'ready' nor 'failed' is written. The 'generating' 409 guard then wedges retries. gpt-image-1 base64 is also stored as a multi-MB data: URI.

Make these changes:

1. New Supabase migration: create a PUBLIC storage bucket `product-artwork` (public select; authenticated insert scoped to auth.uid() path). Add src/lib/product/artwork-storage.ts with uploadProductArtwork({supabase,userId,generationId,base64,mimeType}) -> {publicUrl, storagePath}.

2. src/lib/ajax/adapters/image-generator.ts: build OpenAI client with { timeout: IMAGE_GENERATION_TIMEOUT_MS ?? 45000, maxRetries: 0 }. Return { imageBase64, mimeType } alongside imageUrl from generateProductArtwork.

3. src/lib/ajax/pod/fulfillment-runner.ts: after artwork gen, persist bytes to Storage via an injected persistArtwork callback and use the returned public https URL for printifyAdapter.uploadArtwork and fulfillment.artworkUrl. Add AbortController timeouts around Printify fetches.

4. src/lib/product/generation-pod-runner.ts: allow re-run when status is 'generating' AND updated_at older than 90s (else keep 409). Inject persistArtwork. On ready, also set product_listings.mockup_url to the public URL.

5. New route src/app/api/ajax/product-generations/[id]/fulfill/route.ts: export const maxDuration = 300; POST runs runGenerationPodJob and returns status; GET returns { generationStatus, mockupUrl } for polling.

6. src/lib/ajax/simulator.ts (executeForgeStep): leave generation 'queued'; remove the after() auto-trigger from the interactive path. In src/app/api/cron/run-nova/route.ts, await runGenerationPodJob after Forge for automated cycles.

7. Review UI: in src/components/review/review-dashboard.tsx, when the top item is 'queued' or stale 'generating', POST /fulfill once and poll GET every 3s until ready/failed; add a "Generate / Retry artwork" button. In src/components/review/review-phase2-section.tsx, render the artwork from mockup_url when ready and show Generating/Failed/Retry states.

Constraints: do NOT weaken the Review Gate (drafts only, human approval). Keep RLS enabled. Do not reintroduce any PDF/printable logic. Keep secrets server-only.

Run npm run lint, npm run test, and npm run build and fix anything that breaks.
```

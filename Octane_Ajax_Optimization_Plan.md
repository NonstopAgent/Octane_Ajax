# Octane Ajax — Optimization Plan & Next Steps

> Generated from a full codebase audit (30,701 lines across src/, 257+ tests, latest commit `93dd279`).
> This document covers: critical bugs, UI cleanup, Etsy data integration, and strategic improvements.

---

## Part 1: Critical Bugs (Fix Before Anything Else)

### Bug 1: `downloadProductMockup` Uses Wrong Bucket + Wrong Input Type

**Severity:** CRITICAL — Etsy listing image upload will ALWAYS fail.

**The problem:**

1. `generation-pod-runner.ts` (line 181) stores `mockupStoragePath` as the **full public URL** returned by `uploadPublicArtwork()` (e.g., `https://xyz.supabase.co/storage/v1/object/public/product-artwork/userId/genId.png`).

2. `etsy-on-approve.ts` (line 67) reads `generation.mockupStoragePath` and passes it to `downloadProductMockup()`.

3. `downloadProductMockup()` in `pdf-storage.ts` (line 129) tries to call `supabase.storage.from("product_pdfs").download(storagePath)` — passing a full HTTPS URL as a storage path, in the **wrong bucket** (`product_pdfs` instead of `product-artwork`).

**Result:** Every Etsy listing creation will succeed (draft created), but the image upload will always throw `"Mockup download failed"`, leaving every Etsy draft without a hero image.

**The fix:**

```typescript
// src/lib/product/pdf-storage.ts — replace downloadProductMockup

export async function downloadProductMockup(mockupRef: string): Promise<Buffer> {
  // If it's already a public URL, just fetch it directly.
  if (mockupRef.startsWith("http")) {
    const res = await fetch(mockupRef, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Mockup fetch failed (${res.status}): ${mockupRef}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Legacy path: treat as a storage object path in the artwork bucket.
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_ARTWORK_BUCKET)
    .download(mockupRef);
  if (error || !data) {
    throw new Error(
      `Mockup download failed: ${error?.message ?? "missing file data"}`,
    );
  }
  return Buffer.from(await data.arrayBuffer());
}
```

---

### Bug 2: Settings Page Has Stale Copy

**Severity:** Low (cosmetic, but confusing for you as the operator).

- Line 196: "Forge picks the top-scoring idea and builds a full listing (title, description, **PDF structure**, cover image prompt)" — should say "POD product structure" or "artwork prompt."
- Line 205: "listings go live on Etsy or **LemonSqueezy**" — LemonSqueezy is a dead path for POD. Should just say "Etsy (as drafts)."

---

### Bug 3: `gumroad-on-approve.ts` Still Tries to Download a PDF

**Severity:** Medium — if `LEMONSQUEEZY_API_KEY` is set, it will crash trying to download a non-existent PDF.

The `publishListingToGumroadOnApprove` function (called on every approval in `service.ts` line 300) attempts to `downloadProductPdf()` which expects a PDF storage path. Since you're doing POD (no PDFs), this will always fail if the LemonSqueezy key is configured.

**The fix:** Either remove the Gumroad/LemonSqueezy path entirely (it's dead weight for POD), or gate it on `generation.pdfStoragePath` existing before attempting the download.

---

## Part 2: UI Cleanup (Remove Random Stuff)

The current navigation has 9 items. For an operator running a POD business, several are confusing or redundant:

| Page | Current Purpose | Verdict |
|------|----------------|---------|
| `/dashboard` | Pipeline funnel + weekly metrics + recent events | **KEEP** — this is your command center |
| `/factory` | 3D factory floor, run cycles, order queue, TikTok queue | **KEEP** — core operations |
| `/review` | Human-in-the-loop approval | **KEEP** — the most important page |
| `/marketing` | Pixel's generated social copy | **KEEP but rename** → "Content" |
| `/store` | Public catalog of published listings | **REMOVE or HIDE** — you're selling on Etsy, not here |
| `/operator-store` | Internal view of approved listings | **MERGE into Dashboard** — redundant with the funnel |
| `/agents` | Agent memory/feedback display | **KEEP** — useful for tuning |
| `/war-room` | Strategy recommendations from the archive | **KEEP** — this is valuable |
| `/settings` | Config + Etsy connect | **KEEP but update copy** |

**Recommended NAV_ITEMS (7 instead of 9):**

```typescript
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", description: "Command center" },
  { href: "/factory", label: "Factory", description: "Run cycles & orders" },
  { href: "/review", label: "Review", description: "Approve or reject" },
  { href: "/marketing", label: "Content", description: "Social copy & TikTok" },
  { href: "/agents", label: "Agents", description: "Memory & learning" },
  { href: "/war-room", label: "War Room", description: "Strategy intelligence" },
  { href: "/settings", label: "Settings", description: "Connections & config" },
] as const;
```

Remove `/store` and `/operator-store` from the nav. Keep the routes alive (they don't hurt), just remove them from the sidebar.

---

## Part 3: Etsy Data Integration (Pull Real Analytics)

### Current State

- **OAuth scopes:** `listings_r`, `listings_w`, `shops_r`, `email_r`
- **Missing scope:** `transactions_r` (needed for sales/revenue data)
- **What Nova already pulls:** Active listings search (competitor research) via the Etsy Open API (no OAuth needed, just `ETSY_CLIENT_ID`)
- **What's NOT pulled:** Your own shop's listing performance, sales, revenue, reviews

### What to Build: Etsy Analytics Poller

**Architecture:**

```
Vercel Cron (daily) → /api/cron/etsy-analytics
  → GET /v3/application/shops/{shopId}/listings (your listings with views/favorites)
  → GET /v3/application/shops/{shopId}/receipts (your sales)
  → Upsert into new `listing_performance_snapshots` table
  → Feed into War Room's aggregateArchive
```

**New DB table:**

```sql
create table if not exists public.listing_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  etsy_listing_id text not null,
  listing_id uuid references product_listings(id),
  title text,
  views integer not null default 0,
  favorites integer not null default 0,
  revenue_cents integer not null default 0,
  orders integer not null default 0,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique(user_id, etsy_listing_id, snapshot_date)
);
create index on listing_performance_snapshots (user_id, snapshot_date desc);
alter table listing_performance_snapshots enable row level security;
create policy "own_snapshots" on listing_performance_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**New OAuth scope needed:**

```typescript
// src/lib/ajax/etsy-auth.ts
export const ETSY_OAUTH_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
  "email_r",
  "transactions_r",  // ← ADD THIS
] as const;
```

**Key insight from Etsy API:** Etsy does NOT expose daily view counts or conversion rates. Only lifetime `views` and `num_favorers` per listing. The workaround is to snapshot these daily and calculate velocity (views/day, favorites/day) from the delta.

**What this unlocks:**
- War Room can say "Listing X got 200 views but 0 sales in 7 days — consider revising the title"
- Dashboard can show actual revenue, not just "published count"
- Nova can learn which niches actually convert (not just which get views)

---

## Part 4: Strategic Optimizations

### 4A: Nova Research Seeds Are Too Generic

**Current seeds:**
```
"personalized gift", "funny mug gift", "niche t-shirt gift"
```

**Problem:** These are the most saturated categories on Etsy. Every POD seller targets these exact terms.

**Fix:** Make seeds dynamic based on War Room recommendations and past performance:

```typescript
// Instead of hardcoded RESEARCH_SEEDS, pull from:
// 1. War Room's latest "niche" recommendations (status=accepted)
// 2. Top-performing niches from listing_performance_snapshots
// 3. Fallback to a broader, more creative set

const FALLBACK_SEEDS = [
  "hobby-specific humor apparel",
  "occupation pride gift",
  "pet breed specific accessories",
  "fandom-adjacent aesthetic art",
  "life milestone celebration",
] as const;
```

### 4B: The Approve Flow Does Too Much Synchronously

**Current flow on approve:**
1. Update review_queue status → approved
2. Update listing status → approved
3. Insert content_jobs row for Pixel
4. Call `publishListingToGumroadOnApprove` (LemonSqueezy — dead for POD)
5. Call `publishListingToEtsyOnApprove` (creates Etsy draft + uploads image)
6. Run Pixel marketing (generates TikTok copy + inserts tiktok_queue)
7. Set agent states

**Problem:** Steps 4-6 can take 10-30 seconds (Etsy API + image download + Pixel LLM). The user clicks "Approve" and waits with a spinner.

**Fix:** Only steps 1-3 need to be synchronous. Steps 4-6 should run in `after()` (Next.js background work) or be triggered by a separate `/api/ajax/post-approve` endpoint that the UI polls.

### 4C: Missing `.env.example`

There's no `.env.example` file. This makes it impossible for anyone (including future-you) to know what env vars are needed. There are **22 env vars** referenced across the codebase.

### 4D: Cost Tracking Is Stubbed

`src/lib/llm/cost.ts` exists but the dashboard doesn't show real token burn. Every LLM call should log tokens used + estimated cost to a `llm_usage_log` table so you can see "this cycle cost $0.12" on the dashboard.

### 4E: Printify → Etsy Auto-Sync (The Simpler Path)

**Key insight:** If you connect your Etsy shop to Printify directly (in Printify's dashboard), then calling `publishProduct()` on the Printify API automatically creates the listing on Etsy with all images, variants, and pricing. You don't need the Etsy adapter at all for the initial listing creation.

**Current architecture:**
```
Forge → Artwork → Printify (draft) → [Approve] → Etsy adapter (create draft + upload image)
```

**Simpler architecture:**
```
Forge → Artwork → Printify (draft) → [Approve] → Printify publishProduct() → Etsy (auto-synced)
```

This eliminates the `downloadProductMockup` bug entirely, removes the Etsy adapter complexity for listing creation, and leverages Printify's built-in Etsy integration which handles images, variants, and shipping profiles automatically.

**You'd still need the Etsy adapter for:** reading analytics, pulling receipts/orders, and the webhook for personalized orders.

---

## Part 5: Cursor Prompts (Copy-Paste Ready)

### Prompt 1: Critical Bug Fix + Cleanup (Do This First)

```
Fix the following bugs in the Octane Ajax codebase:

1. In `src/lib/product/pdf-storage.ts`, the `downloadProductMockup` function is broken. It receives a full public URL (like `https://xyz.supabase.co/storage/v1/object/public/product-artwork/...`) but tries to use it as a storage path in the `product_pdfs` bucket. Fix it to:
   - If the input starts with "http", fetch it directly with a 15s timeout
   - Otherwise, download from the `PRODUCT_ARTWORK_BUCKET` (not PRODUCT_PDFS_BUCKET)

2. In `src/app/(command)/settings/page.tsx`:
   - Line 196: Change "PDF structure" to "POD product structure"
   - Line 205: Change "Etsy or LemonSqueezy" to "Etsy (as drafts for your review)"

3. In `src/lib/constants.ts`, remove the `/store` and `/operator-store` entries from NAV_ITEMS. Rename the `/marketing` label from "Marketing" to "Content". Keep the routes/pages intact, just remove from nav.

4. Create a `.env.example` file at the project root listing every `process.env.*` variable used in the codebase with comments explaining which are required vs optional.

Run tests after all changes. The fix to downloadProductMockup must handle both URL formats gracefully.
```

### Prompt 2: Etsy Analytics Integration

```
Add an Etsy analytics polling system to Octane Ajax:

1. Add `"transactions_r"` to the ETSY_OAUTH_SCOPES array in `src/lib/ajax/etsy-auth.ts`.

2. Create a new Supabase migration `supabase/migrations/20260623000000_listing_performance_snapshots.sql` with a `listing_performance_snapshots` table:
   - id (uuid PK), user_id (uuid), etsy_listing_id (text), listing_id (uuid nullable FK to product_listings), title (text), views (int), favorites (int), revenue_cents (int default 0), orders (int default 0), snapshot_date (date), created_at (timestamptz)
   - Unique constraint on (user_id, etsy_listing_id, snapshot_date)
   - RLS: users can only see their own rows

3. Add new methods to the Etsy adapter in `src/lib/ajax/adapters/etsy.ts`:
   - `getShopListings(shopId, accessToken)` → fetches all active listings with views/num_favorers
   - `getShopReceipts(shopId, accessToken, minCreated?)` → fetches recent receipts/transactions

4. Create `src/app/api/cron/etsy-analytics/route.ts`:
   - Reads the user's Etsy credentials from the DB
   - Calls getShopListings to get current views/favorites for each listing
   - Calls getShopReceipts to count orders and sum revenue since last snapshot
   - Upserts into listing_performance_snapshots (one row per listing per day)
   - Add this route to vercel.json crons (daily at 6:00 UTC)

5. Update the War Room's `aggregateArchive` in `src/lib/ajax/warroom/service.ts` to also query listing_performance_snapshots and include performance data (views velocity, conversion rate, revenue) in the archive summary.

6. Add a "Performance" section to the Dashboard that shows:
   - Total revenue this week (from snapshots)
   - Top 5 listings by views velocity (views gained in last 7 days)
   - Listings with high views but zero orders (candidates for title/price revision)

Use the existing Etsy auth refresh pattern from etsy-on-approve.ts. Never throw on API failure — log and continue.
```

### Prompt 3: Async Approve Flow + Cost Tracking

```
Optimize the approve flow and add LLM cost tracking:

1. APPROVE FLOW: In `src/lib/review/service.ts`, the `approveReview` function currently runs Gumroad publish, Etsy publish, and Pixel marketing synchronously. Refactor so that:
   - Only the DB status updates (review_queue → approved, listing → approved) and content_jobs insert happen synchronously
   - The Etsy publish and Pixel marketing run in `after()` (already imported from next/server)
   - Remove the `publishListingToGumroadOnApprove` call entirely (it's dead code for POD — LemonSqueezy is not used)
   - The approve API should return immediately after the DB updates, not wait for Etsy/Pixel

2. LLM COST TRACKING: Create `src/lib/llm/usage-logger.ts`:
   - Export a `logLlmUsage(task, model, promptTokens, completionTokens, costUsd)` function
   - It inserts into a new `llm_usage_log` table (create migration)
   - Wire it into the existing `completeJsonChat` function in `src/lib/llm/json.ts` — after every successful LLM call, log the usage from the response
   - Add a "Cost This Week" metric to the Dashboard showing total LLM spend

3. DYNAMIC RESEARCH SEEDS: In `src/lib/ajax/nova/research.ts`, replace the hardcoded RESEARCH_SEEDS with a function that:
   - Queries the `strategy_recommendations` table for accepted niche recommendations
   - Queries `listing_performance_snapshots` for top-performing niches (if available)
   - Falls back to a broader set of seeds if no data exists yet

Run all tests after changes.
```

---

## Part 6: Priority Order

| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| 1 | Bug 1: Fix downloadProductMockup | Unblocks Etsy image uploads | 10 min |
| 2 | Remove dead Gumroad/LemonSqueezy path | Removes confusion + potential crashes | 15 min |
| 3 | UI cleanup (nav items, settings copy) | Makes the tool usable without confusion | 10 min |
| 4 | .env.example | Prevents "why isn't this working" moments | 5 min |
| 5 | Etsy analytics poller | Unlocks real revenue intelligence | 2-3 hrs |
| 6 | Async approve flow | Better UX, faster approvals | 1 hr |
| 7 | LLM cost tracking | Know what you're spending | 1 hr |
| 8 | Dynamic research seeds | Better ideas over time | 30 min |
| 9 | Consider Printify→Etsy auto-sync | Eliminates Etsy adapter complexity | Research + 1 hr |

**Prompt 1 covers priorities 1-4. Prompt 2 covers priority 5. Prompt 3 covers priorities 6-8.**

---

## Part 7: The Printify→Etsy Question (Decision Required)

You have two paths for getting products onto Etsy:

**Path A (Current):** Octane Ajax creates the Etsy draft listing via the Etsy API, then uploads the mockup image. This gives you full control over titles, descriptions, tags, and pricing directly from your system.

**Path B (Simpler):** Connect Etsy to Printify in Printify's dashboard. Then when Octane Ajax calls `publishProduct()` on the Printify API, Printify automatically creates the Etsy listing with all images, variants, and shipping. You lose some control over the exact listing copy (Printify uses whatever title/description you set on the Printify product).

**My recommendation:** Start with Path A (you already have it built, minus the bug). Path B is a fallback if the Etsy API gives you trouble. The bug fix in Prompt 1 makes Path A work correctly.

---

## Part 8: What's Actually Working Well (Don't Touch)

- Nova LLM ideation with market research grounding (Etsy + Trends + YouTube)
- Product Brain scoring with proper quality gates
- Forge LLM listing generation with POD details
- Multi-model router (gpt-4o-mini for text, gpt-image-1 for artwork)
- Printify adapter with live/demo auto-detection
- Image generator with live/demo auto-detection
- Fulfillment runner with stale-retry guard and timeouts
- War Room strategic analysis
- TikTok queue with copy-to-clipboard for manual posting
- Etsy OAuth PKCE flow
- Etsy order webhook for personalized orders
- Factory 3D visualization
- Review Gate with proper enforcement
- 257+ passing tests
- Vercel cron for automated daily cycles

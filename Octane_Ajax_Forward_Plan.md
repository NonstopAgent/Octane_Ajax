# Octane Ajax: Full Audit & Forward Execution Plan

**Author:** Manus AI  
**Date:** May 18, 2026  
**Repo:** NonstopAgent/Octane_Ajax @ commit `9976733`  
**Live:** https://octane-ajax.vercel.app

---

## Part 1: Honest State of the Project

I audited every file on `master`. Here is the truth — not what Claude or ChatGPT *said* was done, but what the code actually shows.

### What is Real and Working

| Feature | Evidence | Status |
|---------|----------|--------|
| Staged Pipeline (Nova → Forge) | `run-nova/route.ts`, `run-forge/route.ts`, `factory-dashboard.tsx` calls them sequentially | **Shipped** |
| Nova LLM Ideation | `nova/service.ts` calls `completeJson` with real prompts, falls back gracefully | **Shipped** |
| Forge LLM Generation | `forge/service.ts` calls `completeJson`, generates structured product JSON | **Shipped** |
| Product Brain Scoring | `product-brain/scoring.ts` — 7 dimensions, blocked/needs_revision/approve verdicts | **Shipped** |
| PDF Generation & Storage | `pdf-generator.ts` + `pdf-service.ts` + `generation-pdf-runner.ts` — auto-triggers after Forge | **Shipped** |
| Review Gate Enforcement | `approval-guards.ts` — blocks unless PDF ready + sellability passes | **Shipped** |
| Sellability Checklist | `sellability.ts` — 8 checks (pages, cover, instructions, worksheets, AI disclosure, compliance, PDF) | **Shipped** |
| Etsy OAuth + Adapter | `etsy-auth.ts`, `etsy-pkce.ts`, `etsy.ts`, `etsy-on-approve.ts` — full PKCE flow + listing creation | **Shipped** |
| Lemon Squeezy Adapter | `lemonsqueezy.ts` — JSON:API compliant, auto-discovers store ID | **Shipped** |
| Manual URL Fallback | `manual-gumroad-url-form.tsx` + PATCH route | **Shipped** |
| Pixel Promo Package | `pixel-promo-package.ts` — generates TikTok hooks, Pinterest copy, hashtags (deterministic templates) | **Shipped** |
| Factory Floor UI | `factory-map.tsx`, `room-station.tsx`, `agent-sprite.tsx` — rooms, agents, pacing delays | **Shipped** |
| 222 Tests Passing | All test suites green | **Shipped** |

### What is Broken or Missing

| Gap | Impact | Root Cause |
|-----|--------|-----------|
| **No listing images** | Etsy rejects active listings without at least 1 image. Every `etsy_published` attempt will fail. | `image-generator.ts` is a pure stub returning `demo://` URLs. No DALL-E/OpenAI Images integration exists. |
| **Forge falls back to demo in production** | Every product on the live site has generic demo content, not real LLM output | `OPENAI_API_KEY` is likely not set or not reaching the Vercel serverless function. The code itself is correct. |
| **PDF is prototype-grade** | Text-only tables, no color, no branded header, default fonts. Limits pricing to $5-7 max. | `pdf-generator.ts` uses basic `pdf-lib` drawing with minimal styling. |
| **No revenue/sales tracking** | You can't see if anything sold. No webhook integration. | No Etsy order webhook, no Stripe webhook, no revenue counter in the UI. |
| **No marketing UI** | Pixel generates TikTok/Pinterest content but it's invisible — stored in `content_jobs.metadata` with no page to view it. | No `/marketing` page exists. |
| **Pixel is deterministic** | Marketing copy is template-based, not LLM-generated. Generic hashtags like `#OctaneAjax #DemoShop`. | `pixel-promo-package.ts` uses string templates, not `completeJson`. |
| **LLM cost tracking is a stub** | `cost.ts` logs to console only. No DB persistence, no budget alerts. | `persisted: false` hardcoded. No `llm_usage` table. |
| **No `.env.example`** | New developers (or Cursor) can't know what env vars are needed. | File was deleted or never committed. |
| **Nova prompt is static** | Always generates 3 ideas with no memory of past cycles, rejections, or what's already been made. | `buildNovaIdeationUserPrompt` doesn't incorporate feedback or history. |
| **Single-product cycles** | Factory can only run one product at a time. Must approve/reject before next cycle. | `CycleBlockedError` enforces this. |
| **No Etsy listing image upload endpoint** | `etsy.ts` has `uploadListingFile` (PDF) but no `uploadListingImage` method. | Method simply doesn't exist yet. |
| **`when_made` is wrong** | Etsy adapter sends `"2020_2025"` — this will be rejected by Etsy API for new listings in 2026. | Hardcoded string in `etsy.ts` line 112. |
| **Price sent as cents, not dollars** | `body.set("price", String(input.price_cents))` — Etsy expects price in the listing currency (dollars), not cents. | Bug in `etsy.ts` line 110. |

---

## Part 2: The Execution Plan (6 Parallel Lanes for Cursor)

These lanes are independent and can be run simultaneously as separate Cursor tasks. Each one is self-contained.

---

### LANE 1: Fix Etsy Adapter Bugs + Add Image Upload (CRITICAL — DO FIRST)

Without this, no listing will ever go live on Etsy.

```text
Goal: Fix critical bugs in the Etsy adapter and add listing image upload support.

File: src/lib/ajax/adapters/etsy.ts

Bug 1 — Price format:
  Line ~110: body.set("price", String(input.price_cents))
  Fix: body.set("price", String((input.price_cents / 100).toFixed(2)))
  Etsy expects price in listing currency (USD), not cents.

Bug 2 — when_made value:
  Line ~112: body.set("when_made", "2020_2025")
  Fix: body.set("when_made", "2020_2026")
  Etsy rejects values that don't include the current year range.

Feature — Add uploadListingImage method:
  Add to the adapter object returned by createEtsyAdapter():

  async uploadListingImage(
    listingId: string,
    imageBuffer: Buffer,
    filename: string,
    shopId: string,
    accessToken: string,
    rank?: number,
  ): Promise<{ listing_image_id: string }> {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }),
      filename,
    );
    form.append("rank", String(rank ?? 1));

    const response = await fetchImpl(
      `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images`,
      {
        method: "POST",
        headers: authHeaders(clientId, accessToken),
        body: form,
      },
    );

    const parsed = await parseEtsyJson<{ listing_image_id?: number }>(response);
    const imageId = parsed.listing_image_id != null ? String(parsed.listing_image_id) : "unknown";
    return { listing_image_id: imageId };
  }

Update src/lib/ajax/adapters/etsy.test.ts:
  - Add test for price conversion (799 cents → "7.99")
  - Add test for when_made value
  - Add test for uploadListingImage (mock fetch)

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

### LANE 2: Mockup Image Generator (DALL-E 3)

This generates the required Etsy listing image.

```text
Goal: Generate product mockup images using DALL-E 3 and wire them into the Etsy publish flow.

1. Create migration: supabase/migrations/20260519000000_mockup_storage_path.sql
   ALTER TABLE product_generations ADD COLUMN IF NOT EXISTS mockup_storage_path text;

2. Update src/lib/supabase/database.types.ts:
   Add mockup_storage_path: string | null to product_generations Row, Insert, Update.

3. Update src/lib/product/mappers.ts:
   Add mockupStoragePath to the mapped ProductGeneration domain type.

4. Create src/lib/product/mockup-generator.ts:
   import OpenAI from "openai";
   import { createOpenAiClient } from "@/lib/llm/openai";

   export async function generateListingMockup(input: {
     title: string;
     niche: string;
     format: string;
     pageCount: number;
     generationId: string;
     userId: string;
     supabase: Supabase;
   }): Promise<{ storagePath: string } | null> {
     const client = createOpenAiClient({ timeout: 30_000 });
     const prompt = `Clean flat-lay product mockup photograph: a printed ${input.format} titled "${input.title}" for ${input.niche}. Show ${input.pageCount} pages artfully spread on a light wooden desk with a coffee cup and pen nearby. Minimal lifestyle photography, soft natural lighting, top-down view, high resolution, no text overlays.`;

     const response = await client.images.generate({
       model: "dall-e-3",
       prompt,
       n: 1,
       size: "1024x1024",
       quality: "standard",
     });

     const imageUrl = response.data[0]?.url;
     if (!imageUrl) return null;

     // Download the temporary URL
     const imageRes = await fetch(imageUrl);
     const buffer = Buffer.from(await imageRes.arrayBuffer());

     // Upload to Supabase Storage
     const path = `${input.userId}/${input.generationId}_mockup.jpg`;
     const { error } = await input.supabase.storage
       .from("product_pdfs")
       .upload(path, buffer, { contentType: "image/jpeg", upsert: true });

     if (error) {
       console.error("[mockup-generator] upload failed:", error.message);
       return null;
     }

     // Update the generation row
     await input.supabase
       .from("product_generations")
       .update({ mockup_storage_path: path })
       .eq("id", input.generationId);

     return { storagePath: path };
   }

5. Wire into src/lib/product/generation-pdf-runner.ts:
   After PDF generation succeeds (the pdf_ready event), call generateListingMockup
   in a fire-and-forget pattern. Log "mockup_ready" or "mockup_generation_failed" events.

6. Wire into src/lib/review/etsy-on-approve.ts:
   Before calling createDraftListing, check if generation.mockupStoragePath exists.
   After creating the listing, if mockup exists:
     - Download mockup from Supabase Storage
     - Call adapter.uploadListingImage(listingId, buffer, "mockup.jpg", shopId, token)
   If no mockup: still create the listing (it may work as draft, or fail — log the error).

7. Add GET /api/ajax/product-generations/[id]/mockup-download route:
   Same pattern as pdf-download — auth check, create signed URL, redirect.

8. In src/components/review/review-pdf-panel.tsx:
   If mockup_storage_path exists, show a small thumbnail image.

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

### LANE 3: PDF Visual Quality Upgrade

```text
Goal: Make the generated PDFs look professional enough to sell at $9.99-$14.99.

File: src/lib/product/pdf-generator.ts

Current state: Basic text rendering with minimal styling. No branded elements.

Upgrade requirements:
1. Cover page redesign:
   - Full-width colored header band (use a muted blue-gray: rgb(0.22, 0.35, 0.53))
   - Product title in large bold white text centered on the band
   - Subtitle line: "A {format} for {niche}" in smaller text
   - "Created with AI assistance" disclosure in small footer text
   - Page number omitted on cover

2. Section headers:
   - Add a thin colored rule (2pt) above each section heading
   - Section headings in bold, slightly larger than body text
   - Add 8pt spacing after the rule before the heading text

3. Tables:
   - Add alternating row shading (every other row gets a very light gray fill)
   - Add proper cell padding (4pt top/bottom, 8pt left/right)
   - Header row gets the muted blue-gray background with white text

4. Fields (text inputs, checkboxes):
   - Draw a subtle rounded rectangle border around text input areas
   - Checkboxes: draw a proper square outline (not just "[ ]" text)
   - Add field labels in a slightly smaller, muted color above the input area

5. Footer:
   - Every page (except cover) gets a thin rule at the bottom
   - Left-aligned: product title in 7pt muted text
   - Right-aligned: "Page X of Y" in 7pt muted text

6. Typography:
   - Use Helvetica (StandardFonts.Helvetica / HelveticaBold) instead of the current font
   - Title: 22pt bold
   - Section heading: 14pt bold
   - Body: 10pt regular
   - Field labels: 9pt muted
   - Footer: 7pt muted

Do NOT change the document structure logic in structure-to-document.ts.
Only change the rendering/drawing code in pdf-generator.ts.

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

### LANE 4: Nova Memory + Smarter Ideation

```text
Goal: Make Nova smarter by incorporating feedback from past cycles.

1. Update src/lib/ajax/nova/prompts.ts — buildNovaIdeationUserPrompt():
   Accept an optional parameter: pastContext: { rejectedNiches: string[], approvedNiches: string[], recentTitles: string[] }
   
   If pastContext is provided, append to the user prompt:
   
   "IMPORTANT CONTEXT FROM PAST CYCLES:
   - Previously REJECTED niches (do NOT repeat these): {rejectedNiches.join(", ")}
   - Previously APPROVED niches (you can explore adjacent ideas): {approvedNiches.join(", ")}
   - Recent product titles already created (avoid duplicates): {recentTitles.join(", ")}
   
   Generate ideas that are DIFFERENT from all of the above. Explore new territory."

2. Update src/lib/ajax/nova/service.ts — runNovaIdeation():
   Accept optional pastContext parameter. Pass it through to buildNovaIdeationUserPrompt.

3. Update src/lib/ajax/simulator.ts — runNovaStep():
   Before calling runNovaIdeation, query the database:
   - Get the last 10 rejected listings (status = 'rejected') → extract niche from raw_payload
   - Get the last 10 approved listings (status = 'approved' or 'published') → extract niche
   - Get the last 20 product_ideas titles
   Pass this as pastContext to runNovaIdeation.

4. Update the Nova system prompt to emphasize:
   "You have access to the operator's history. NEVER repeat a niche that was rejected.
   Explore adjacent but distinct niches to approved products. Diversify."

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

### LANE 5: Pixel LLM Upgrade (Real Marketing Copy)

```text
Goal: Replace Pixel's deterministic template marketing with real LLM-generated copy.

1. Create src/lib/ajax/pixel/prompts.ts:
   Export PIXEL_MARKETING_SYSTEM_PROMPT:
   "You are Pixel, the marketing agent for Octane Ajax. Generate compelling social media marketing copy for digital download products sold on Etsy. Be specific, benefit-focused, and use hooks that stop scrollers."

   Export PIXEL_MARKETING_JSON_INSTRUCTIONS with this schema:
   {
     "shortCaption": "string — 1-2 sentence Instagram/TikTok caption with emoji",
     "longCaption": "string — 3-4 sentence detailed caption for Pinterest/Facebook",
     "pinterestTitle": "string — SEO-optimized Pinterest pin title (max 100 chars)",
     "pinterestDescription": "string — keyword-rich Pinterest description (max 500 chars)",
     "tiktokHookIdeas": ["string", "string", "string"] — 3 scroll-stopping video hook ideas,
     "hashtags": ["string", ...] — 8-12 relevant hashtags (no # prefix, the code adds it)
   }

2. Create src/lib/ajax/pixel/service.ts:
   Export async function generatePixelMarketing(input: PixelPromoInput): Promise<PixelPromoPackage>
   - If isOpenAiConfigured(): call completeJson with the Pixel prompts
   - Else: fall back to the existing deterministic buildPixelPromoPackage()

3. Update src/lib/ajax/pixel-simulator.ts:
   In the section where it calls buildPixelPromoPackage(), replace with:
   - Try generatePixelMarketing() first
   - On failure, fall back to buildPixelPromoPackage()

4. Create src/app/(command)/marketing/page.tsx:
   - Server component that fetches all content_jobs for the user
   - Displays each job's metadata (shortCaption, tiktokHookIdeas, hashtags, pinterestTitle)
   - "Copy" buttons for each field
   - Link back to the associated listing

5. Add "Marketing" to the sidebar navigation in src/components/layout/command-header.tsx

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

### LANE 6: Revenue Dashboard + Env Hygiene

```text
Goal: Add a revenue tracking dashboard and fix environment configuration.

1. Create .env.example at project root:
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   
   # OpenAI (required for Nova, Forge, Pixel LLM, and DALL-E mockups)
   OPENAI_API_KEY=
   
   # Etsy OAuth (required for auto-publishing)
   ETSY_CLIENT_ID=
   ETSY_CLIENT_SECRET=
   NEXT_PUBLIC_APP_URL=https://octane-ajax.vercel.app
   
   # Lemon Squeezy (optional alternative marketplace)
   LEMONSQUEEZY_API_KEY=
   
   # Gumroad (deprecated — kept for legacy manual URL support)
   GUMROAD_ACCESS_TOKEN=

2. Update src/app/(command)/dashboard/page.tsx:
   Replace the current minimal dashboard with a proper revenue overview:
   - Total listings published (count from product_listings where status = 'published')
   - Total products generated this week
   - Estimated LLM spend (sum from factory events with cost metadata)
   - Pipeline status: how many ideas → how many passed brain → how many approved
   - Show the last 5 factory events in a timeline

3. Create src/lib/factory/revenue-queries.ts:
   - getPublishedListingCount(supabase, userId)
   - getWeeklyGenerationCount(supabase, userId)
   - getPipelineFunnel(supabase, userId) → { ideas, passed, approved, published }

4. Update src/components/dashboard/dashboard-view.tsx:
   - Display the metrics in a clean grid layout
   - Show pipeline funnel as a simple bar chart or progress indicators

Run npm run lint && npm run test && npm run build. Do not commit.
```

---

## Part 3: Cursor Multitask Execution Strategy

### How to Run These in Cursor

Open 3-4 Cursor Composer windows simultaneously:

| Window | Lane | Why It's Independent |
|--------|------|---------------------|
| 1 | Lane 1 + Lane 2 (sequential) | Lane 2 depends on Lane 1's `uploadListingImage` method |
| 2 | Lane 3 | Only touches `pdf-generator.ts` — no overlap |
| 3 | Lane 4 + Lane 5 (sequential) | Lane 5's Pixel prompts follow the same pattern as Lane 4's Nova memory |
| 4 | Lane 6 | Only touches dashboard + new files — no overlap |

### Commit Strategy

After each lane finishes and tests pass:
```powershell
git add -A
git diff --cached --stat  # verify no secrets
git commit -m "Lane X: [description]"
```

Push all at once after all lanes are done:
```powershell
git push origin master
```

---

## Part 4: After All Lanes Are Done

Once all 6 lanes are committed and deployed:

1. **Verify Forge LLM:** Run a cycle on the live site. Check factory events — `llm_model` should show `gpt-4o-mini`, not `null`.
2. **Verify Mockup:** After Forge completes, check `product_generations.mockup_storage_path` — should have a value.
3. **Connect Etsy:** Go to `/settings/etsy-connect` → complete OAuth.
4. **First Real Listing:** Run cycle → Review → Approve → Check Etsy shop for the live listing with image + PDF.
5. **Price Your First Product:** Based on the PDF quality and page count, set a realistic price ($7.99-$12.99 for the first few).

---

## Part 5: What Comes After First Revenue

These are NOT for now. Park them until you've made your first sale:

| Future Feature | When to Build |
|----------------|---------------|
| Etsy order webhooks (real-time revenue tracking) | After first 5 sales |
| Batch cycle mode (generate 5 products per run) | After first 20 listings live |
| A/B testing titles via Etsy stats API | After 30 days of sales data |
| TikTok Shop integration | After $500/month revenue |
| Polymarket trading module | After $1000/month revenue |
| SaaS mode (multi-tenant) | After you've proven the model works for yourself |

---

## Part 6: The One Thing That Matters Most

Everything above is engineering. The one thing that actually determines whether this makes money is:

**Is `OPENAI_API_KEY` set in your Vercel environment variables?**

If it's not, every single cycle produces generic demo content. The PDF is generic. The listing is generic. The mockup prompt is generic. Nothing sells.

Go to Vercel → Settings → Environment Variables → confirm `OPENAI_API_KEY` is there. If it is, the entire pipeline works. If it's not, nothing else matters until you add it.

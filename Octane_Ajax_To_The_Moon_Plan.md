# Octane Ajax: "To The Moon" Master Plan

After a full forensic audit of your actual local codebase (commit `93dd279`), synthesizing all past conversations with Claude, Gemini, ChatGPT, and Manus, here is the definitive assessment and forward plan.

## The Ground Truth: What's Actually Built

1. **The POD Pivot is Real & Complete:** 
   - `printify-catalog.ts` is fully deterministic with verified IDs (Mug, Poster, Tee, Crewneck).
   - Nova's prompts exclusively target physical POD gifts.
   - The test suite is 100% green (257/257 pass).
   - The `after()` serverless fix is in place, ensuring background generation survives Vercel's container freezes.
   - The Cron route correctly uses the service-role client to trigger automated cycles.

2. **The Etsy Publish Path is Dangerously Misaligned:**
   - **CRITICAL GAP:** The Etsy adapter (`src/lib/ajax/adapters/etsy.ts`) is still hardcoded for digital downloads. It sets `taxonomy_id` to `2078` (digital), `type` to `"download"`, and `state` to `"active"`. 
   - Even worse, it attempts to upload a PDF file (`uploadListingFile`) rather than syncing the Printify draft to Etsy.
   - *This means if you approve a Printify product today, the system will try to push a digital PDF to Etsy and instantly publish it live.*

3. **The Review UI Still Thinks It's Selling PDFs:**
   - `src/components/review/review-pdf-panel.tsx` still exists and displays "Generate PDF" buttons and status.
   - `src/app/api/ajax/product-generations/[id]/pdf-download/route.ts` still exists.

4. **Financial Telemetry is Missing:**
   - The 3D factory HUD does not yet display the real-time LLM token burn or cost estimates discussed in `pasted_content_11.txt`.

---

## The "To The Moon" Execution Plan

This plan is broken into 3 parallel lanes that you can paste directly into Cursor Composer windows.

### Window 1: The Critical Publish Path Fix (Etsy POD Alignment)
*This is the most important fix. It stops the system from pushing PDFs to Etsy.*

**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Align the Etsy Adapter and Publish Flow with the POD Pivot

Context: We successfully pivoted to Printify POD fulfillment, but the Etsy publish path is still hardcoded for digital downloads (PDFs) and active publishing. We need to fix this so approving a Review Gate item pushes a physical draft to Etsy.

Step 1: Update src/lib/ajax/adapters/etsy.ts
- Modify `createDraftListing`. Change `type` from "download" to "physical".
- Remove the hardcoded digital `taxonomy_id`. Accept it as an optional parameter, or omit it to let Etsy default it based on tags/title.
- CRITICAL: Change `state` from "active" to "draft". We NEVER publish live automatically.
- Remove `who_made` and `when_made` or update them to valid physical POD values (e.g., `who_made: "someone_else"`, `when_made: "2020_2026"`).

Step 2: Update src/lib/review/etsy-on-approve.ts
- Remove all logic related to downloading and uploading PDFs (`downloadPdf`, `uploadListingFile`).
- The adapter should only create the draft listing and optionally upload the mockup image (`uploadListingImage`).
- Note: Since Printify handles the actual product syncing to Etsy, if the Printify draft is already connected to the Etsy shop, we might not even need to create the Etsy listing manually here. Investigate if we should just let Printify's "Publish" API handle the Etsy sync entirely. If so, rewrite `publishListingToEtsyOnApprove` to call the Printify Adapter's publish method instead of the Etsy Adapter.

Step 3: Run `npm run build` and `npm test` to ensure nothing broke.
```

### Window 2: UI/UX Cleanup (Exorcising the PDF Ghost)
*This removes the confusing PDF UI from the Review Gate.*

**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Remove Legacy PDF UI from Review Gate

Context: We are a 100% physical POD factory now. We need to remove the last visual remnants of the digital download era from the Review Gate.

Step 1: Audit src/components/review/review-pdf-panel.tsx
- This component still shows "Generate PDF", "PDF ready", and "Download PDF".
- Refactor or replace this component to strictly display the Printify Draft Status and the generated Mockup/Artwork image.
- Rename the file to `review-artwork-panel.tsx` if appropriate, and update imports in `review-card.tsx`.

Step 2: Delete Legacy Routes
- Delete `src/app/api/ajax/product-generations/[id]/pdf-download/route.ts` as it is no longer needed.
- Delete `src/app/api/ajax/product-generations/[id]/mockup-download/route.ts` if the UI can just serve the Supabase storage URL directly.

Step 3: Run `npm run build` and `npm test`.
```

### Window 3: The 3D Factory Financial Telemetry
*This brings the "Business Engine" vision to life by showing real money burning.*

**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Wire Real-Time Financial Telemetry into the 3D HUD

Context: We want to surface real-time LLM token usage and estimated $ cost per agent in the 3D HUD and zone inspectors, as discussed previously.

Step 1: Backend Snapshot Enrichment
- Update `src/lib/factory/queries.ts` (specifically `fetchFactorySnapshot` and `fetchSweatshopSnapshot`).
- Aggregate the total tokens used and total $ cost incurred per agent from the database (e.g., from `product_generations` or `events`). You can use the existing logic in `src/lib/llm/cost.ts`.
- Update `src/lib/factory/types.ts` to include this telemetry in the snapshot payload.

Step 2: HUD & Inspector UI Updates
- Update the HUD overlay in `src/components/factory/factory-sweatshop.tsx` or `factory-floor-3d.tsx`.
- Add a "GLOBAL BURN" metric showing total $ spent this session/lifetime.
- When clicking an agent's zone, the 3D Inspector panel MUST display that specific agent's real Token Count and $ Cost.

Step 3: Run `npm run build` and `npm test`.
```

---

## Immediate Action Required by You (The Operator)

Before running these prompts, ensure your API keys are correct in Vercel:
1. **OPENAI_API_KEY:** Ensure this is funded and the org is verified.
2. **PRINTIFY_API_TOKEN & PRINTIFY_SHOP_ID:** Ensure these are set.
3. **ETSY_CLIENT_ID:** Ensure this is set.

Once you run these 3 Cursor lanes, your factory will be 100% aligned: Nova thinks POD, Forge builds POD, the UI shows POD, and Etsy receives a physical POD draft. Plus, you'll see the live cost ticking up in your 3D dashboard.

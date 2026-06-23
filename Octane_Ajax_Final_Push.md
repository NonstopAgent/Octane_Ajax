# Octane Ajax: The Final Push to the Moon

I have fully audited the local codebase after Claude's latest session. 

## The Good News
Claude successfully implemented both Window 1 and Window 2 from our previous plan:
- The `/fulfill` route now correctly has `maxDuration = 300`.
- The Printify API calls now have a 15-second `AbortController` timeout to prevent hanging.
- The cron route now triggers `runGenerationPodJob` inline, ensuring automated daily cycles actually produce artwork.
- The Etsy adapter is now safely configured to push **physical drafts** instead of live digital PDFs.
- The test suite is green (257/257 pass), the build compiles perfectly, and Claude even fixed the 5 pre-existing lint errors.

**The system is now structurally sound and safe to connect to real Etsy and Printify accounts.**

## The Final Gaps (What's left to optimize)

To truly take this "to the moon" and make it a polished, production-ready SaaS/internal tool, there are three remaining areas of friction that need to be cleaned up:

### 1. The "Published" State Mismatch
Currently, when you approve a listing at the Review Gate, the Etsy adapter correctly creates a **draft** on Etsy. However, internally, `src/lib/review/service.ts` still marks the local listing status as `published`. This causes the item to immediately show up on your public `/store` route, even though it's not actually live for sale on Etsy yet. 
**Fix:** The internal state should remain `approved` (or a new state like `draft_synced`) until you explicitly confirm it is live on the external platform.

### 2. The Legacy PDF UI Ghost
The Review Gate asset panel is still named `review-pdf-panel.tsx`. While Claude wired it to trigger the new POD fulfillment route, it still contains legacy code for "Download legacy PDF". This is confusing technical debt that should be fully exorcised now that the POD pivot is complete.

### 3. The Financial Telemetry (The "Business Engine" Vision)
We still haven't wired the real-time LLM token burn and cost estimates into the 3D factory HUD. This was Window 3 from the original "To The Moon" plan and is crucial for understanding the unit economics of the factory.

---

## The Action Plan (The Final Cursor Prompts)

Run these two prompts in separate Cursor Composer windows to finish the polish.

### Window 1: State Alignment & UI Cleanup
**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Align internal listing state with external draft status and remove legacy PDF UI

Context: We fixed the Etsy adapter to only create drafts, but our internal system still marks the listing as "published" upon approval, making it show up on the /store route prematurely. We also need to finish cleaning up the legacy PDF UI.

Step 1: Update `src/lib/review/service.ts`
- When `publishListingToEtsyOnApprove` succeeds, do NOT update the listing status to `published`. Leave it as `approved` (or add a new `synced_draft` status if appropriate). 
- The item should only become `published` (and appear on `/store`) when we get a webhook or manually confirm it is live on Etsy/Gumroad.

Step 2: Rename and clean up the Review Panel
- Rename `src/components/review/review-pdf-panel.tsx` to `review-artwork-panel.tsx`.
- Remove the `legacyPdfHref` logic and any remaining "Download legacy PDF" buttons. It should strictly be an artwork/mockup viewer.
- Update `src/components/review/review-phase2-section.tsx` and any tests (like `demo-workflow.test.mjs`) to reflect the new name and behavior.

Step 3: Run `npm run lint`, `npm run test`, and `npm run build` to ensure nothing breaks.
```

### Window 2: Financial Telemetry
**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Wire Real-Time Financial Telemetry into the 3D HUD

Context: We want to surface real-time LLM token usage and estimated $ cost per agent in the 3D HUD and zone inspectors to monitor our unit economics.

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

Once these two windows are complete, Octane Ajax is ready for prime time.

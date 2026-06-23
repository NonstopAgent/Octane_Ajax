# Octane Ajax: Assessment & Next Steps

I have reviewed Claude's implementation of the Artwork/POD Fulfillment Fix and verified the current state of your local codebase.

## What Claude Successfully Implemented

Claude correctly diagnosed the core issue: the `gpt-image-1` call was taking too long and getting killed by Vercel's 60-second function timeout because it shared the budget with Forge's text generation.

Here is what Claude successfully fixed:
1. **Hard Timeout on OpenAI:** `image-generator.ts` now enforces a 45-second timeout on the image generation call so it fails cleanly instead of hanging.
2. **Stale Retry Guard:** `generation-pod-runner.ts` now allows retrying rows stuck in `generating` if they are older than 90 seconds.
3. **Storage Persistence:** Artwork is now saved to the Supabase `product_pdfs` bucket as an actual file, rather than being stored as a massive base64 string in the database.
4. **Dedicated Route:** A new `/api/ajax/product-generations/[id]/fulfill/route.ts` was created to run fulfillment on its own budget.
5. **Review UI Polling:** The Review Gate UI now automatically triggers and polls the new `/fulfill` route until the artwork is ready.

## The Remaining Gaps (What Claude Missed or Skipped)

While Claude fixed the immediate hanging issue, a few critical things from the plan were left incomplete:

1. **The 60-Second Limit Still Exists:** The new `/fulfill` route still has `export const maxDuration = 60;`. Claude noted this was because Vercel Hobby is capped at 60s, but if you are on Vercel Pro, this needs to be raised to `300` to actually give the image generator more breathing room.
2. **No Printify Timeouts:** Claude planned to add `AbortController` timeouts around the Printify API calls in `fulfillment-runner.ts`, but did not actually implement them. If Printify's API hangs, the function will still wedge.
3. **The Legacy Auto-Trigger Still Exists:** Claude intentionally left the old `after()` trigger in `executeForgeStep` as a fallback. This creates a race condition where the serverless function and the Review UI might both try to trigger fulfillment at the same time.
4. **Cron Route Not Updated:** The automated daily cron job (`run-nova/route.ts`) was not updated to trigger the new `/fulfill` path.

## The Action Plan (Next Steps for Cursor)

You now have two sets of critical fixes to apply. I recommend running these in two separate Cursor Composer windows.

### Window 1: Finish Claude's Fulfillment Fixes

**Prompt for Cursor:**
```text
Project: Octane Ajax
Task: Complete the missing pieces of the Artwork Fulfillment Fix

Context: We recently moved POD fulfillment to a dedicated route to avoid Vercel timeouts, but a few critical pieces were missed.

Step 1: Increase Route Timeout
- In `src/app/api/ajax/product-generations/[id]/fulfill/route.ts`, change `export const maxDuration = 60;` to `300`. (We are on Vercel Pro).

Step 2: Add Printify Timeouts
- In `src/lib/ajax/pod/fulfillment-runner.ts`, wrap the `printifyAdapter.uploadArtwork` and `printifyAdapter.createProduct` calls with an `AbortController` timeout (e.g., 15 seconds) so they fail cleanly if the Printify API hangs.

Step 3: Update the Cron Job
- In `src/app/api/cron/run-nova/route.ts`, after `runForgeStep`, add a call to `runGenerationPodJob` so the automated daily cycle actually triggers fulfillment.

Step 4: Run `npm run build` and `npm test` to verify.
```

### Window 2: The Critical Etsy Safety Fix (Manus W1)

*This is the fix from my previous audit that stops the system from pushing PDFs to Etsy.*

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

Once you run these two windows, your factory will be robust against timeouts and safe to connect to a real Etsy account.

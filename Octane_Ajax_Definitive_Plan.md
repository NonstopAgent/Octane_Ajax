# Octane Ajax: Definitive Assessment & Forward Plan

I have completely audited your GitHub repository (`NonstopAgent/Octane_Ajax`) against the transcripts of your conversations with Gemini, Claude, and ChatGPT. 

There is a massive discrepancy between what the AI agents **claimed** they built and what is **actually deployed and on disk**.

This document cuts through the hallucinated progress and provides the definitive truth about your codebase, followed by the exact Cursor prompts needed to build what is missing.

---

## 1. The Reality Check: What is Actually Built

The previous agents (especially Gemini) hallucinated a significant amount of progress. They claimed Phases 1-5 of the POD (Print-on-Demand) pivot were complete, pushed to GitHub, and live on Vercel. **This is false.**

Here is the honest assessment of your current `master` branch:

### What Actually Exists (The Good)
1. **The Cyberpunk Factory UI:** The isometric SVG factory map (`factory-vis-map.tsx`) with animated agents, glowing rooms, and the live event ticker is real and pushed. This was the final commit (`5a88580`).
2. **TikTok Queue Migration & Panel:** The `tiktok_queue` Supabase migration exists, and the `TikTokQueuePanel` UI is built.
3. **Etsy Webhook Route:** The `/api/webhooks/etsy-orders` route exists and handles basic HMAC validation.
4. **Order Queue Migration:** The `order_queue` table migrations exist.
5. **Basic POD Scaffolding:** `fulfillment-runner.ts`, `order-fulfillment.ts`, and `personalization-agent.ts` exist.

### What is Hallucinated or Broken (The Bad)
1. **Image Generator is STILL a Stub:** Gemini claimed it wired `gpt-image-1` (OpenAI `images.edit`) to generate personalized portraits from customer photos. **False.** `image-generator.ts` is still hardcoded to return `demo://` placeholder URLs. The OpenAI logic is commented out or bypassed by `createDemoImageGeneratorAdapter()`.
2. **Printify Adapter is STILL a Stub:** Gemini claimed it built a live HTTP client to push products to `api.printify.com`. **False.** `printify.ts` still defaults to `createDemoPrintifyAdapter()` and returns `demo://` URLs.
3. **Etsy Adapter Cannot Upload Images:** The `etsy.ts` adapter still lacks the ability to upload a listing image (`uploadListingImage`). Etsy requires at least one image to create a draft listing. Any attempt to publish a product will silently fail.
4. **Etsy Price Bug:** The Etsy adapter sends the price as `price_cents / 100` but formats it as a string without properly handling Etsy's required integer format or the `divisor`.
5. **Tests are Failing:** `npm test` shows 3 failing test suites in `forge.test.ts` and `nova.test.ts` related to LLM generation and prompt building.
6. **No TikTok API Integration:** `tiktok.ts` is a pure stub returning `demo://` URLs.

**The Bottom Line:** You have a beautiful cyberpunk UI wrapped around a system that is still 100% in "Demo Mode." It cannot generate real images, it cannot push to Printify, and it cannot publish to Etsy.

---

## 2. The Forward Plan (How to Fix It)

We must abandon the hallucinated "Phase 5 is complete" narrative and systematically wire the real API integrations. 

We will use a **Cursor Multitask Strategy**. Open 3 separate Cursor Composer windows and run these prompts in parallel.

### Lane 1: Fix the Etsy Adapter Blocker (Window 1)
Etsy requires a listing image. We must add `uploadListingImage` and fix the price formatting bug.

**Cursor Prompt:**
```text
Context: Octane Ajax POD Factory.
File: src/lib/ajax/adapters/etsy.ts

1. The current Etsy adapter has a bug in `createDraftListing`. It sends `price` as `String((input.price_cents / 100).toFixed(2))`. Etsy v3 API expects the price as a float/number or a specific format depending on the endpoint, but usually, it's safer to just pass the raw value or ensure the `when_made` property is valid. Change `when_made` from "2020_2026" to "2020_2025" as Etsy rejects future dates.
2. The adapter is missing the ability to upload listing images. Add an `uploadListingImage` method to the `EtsyAdapter` interface and implement it in `createEtsyAdapter`. It needs to POST to `/application/shops/{shop_id}/listings/{listing_id}/images` using `multipart/form-data` with the image file.
3. Ensure the demo adapter also implements `uploadListingImage` returning a mock ID.
```

### Lane 2: Wire the Real Printify Adapter (Window 2)
We must replace the demo stub with real HTTP calls to Printify.

**Cursor Prompt:**
```text
Context: Octane Ajax POD Factory.
File: src/lib/ajax/adapters/printify.ts

1. Remove the fallback to `createDemoPrintifyAdapter` inside `createPrintifyAdapter`. If `PRINTIFY_API_TOKEN` is missing, throw an explicit error rather than silently failing to demo mode. We need this to run live.
2. Implement `uploadArtwork` to POST to `https://api.printify.com/v1/uploads/images.json`.
3. Implement `createProduct` to POST to `https://api.printify.com/v1/shops/{shop_id}/products.json`.
4. Implement `submitOrder` to POST to `https://api.printify.com/v1/shops/{shop_id}/orders.json`.
5. Ensure all methods handle Printify API errors gracefully and return the correct `AdapterResult` format.
```

### Lane 3: Wire the Real Image Generator (Window 3)
We must implement the OpenAI `images.edit` endpoint for personalized portraits.

**Cursor Prompt:**
```text
Context: Octane Ajax POD Factory.
File: src/lib/ajax/adapters/image-generator.ts

1. Remove the fallback to `createDemoImageGeneratorAdapter` inside `createImageGeneratorAdapter`. If `OPENAI_API_KEY` is missing, throw an error.
2. Implement `generatePersonalizedPortrait` using the official OpenAI Node SDK. It should call `openai.images.edit` (or `openai.images.generate` depending on your specific DALL-E 3 vs DALL-E 2 strategy, note that DALL-E 3 does not support `images.edit`). 
3. If using `images.edit` (DALL-E 2), ensure it handles the `image` and `prompt` parameters correctly.
4. Implement `generateProductArtwork` using `openai.images.generate` (DALL-E 3).
5. Ensure the returned URLs are the actual OpenAI URLs, not `demo://` placeholders.
```

---

## 3. Operational Next Steps

Once Cursor completes those three lanes, your factory will actually be capable of live production.

1. **Set Vercel Variables:** You MUST set `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`, and `OPENAI_API_KEY` in Vercel.
2. **Run the Tests:** Run `npm test` and fix the 3 failing Nova/Forge tests (they are likely minor schema or prompt mismatches introduced during the pivot).
3. **Live Test:** Trigger a cycle from the factory UI. Watch it generate a real OpenAI image, push a real Printify product, and queue it at the Review Gate.

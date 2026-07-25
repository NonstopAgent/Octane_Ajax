# Octane Ajax — Engineering Audit

**Date:** 2026-07-25
**Commit audited:** `003a85a` — *"Funnel audit reads the truth; heal passes re-pin free shipping"*
**Scope:** full repo — 322 TS/TSX files, 51,621 LOC, 21 migrations, 60 API routes, 7 crons
**Method:** four parallel deep audits (security / money path / reliability / code quality), then every finding re-verified by hand against source. Claims that didn't survive verification were dropped.

---

## TL;DR

The engineering craft here is genuinely above average — zero `any`, zero `@ts-ignore`, `strict: true`, real zod validation on all LLM output, a disciplined adapter house style, and code comments that document *why* a fix was made and what broke to cause it. That's rare.

The problems are not sloppiness. They're a specific, repeating pattern: **a bug gets found and fixed in one place, and the same bug survives in its sibling.** The `after()` fix, the multi-variant print-fit fix, the `.ok`-before-`.json()` pattern, the rotation-instead-of-slice fix, the response-check on publish — each was correctly diagnosed, correctly fixed once, and left in place elsewhere. Several of this report's worst findings are just the un-fixed copy.

**Three things are on fire:**

1. **The Human Review Gate does not exist in practice.** `AGENTS.md` §3 says nothing publishes live without human review. The hourly autopilot cron calls the auto-reviewer with `act: true` hardcoded and publishes live to Etsy. Every product in the shop can reach the public with zero human input.
2. **The Etsy order webhook is unauthenticated when `ETSY_WEBHOOK_SECRET` is unset** — and it runs under the service role, spends OpenAI credits, and submits billable Printify production orders.
3. **Live customer orders can ship to a hardcoded fake address** (`123 Demo Street, Los Angeles`) when Etsy's payload is missing any one shipping field.

**And the safety net is weaker than it looks:** `npm test` reports a green 390/390, but the script is a hand-maintained list of 54 paths — 3 point at deleted files (silently skipped by `node --test`), and 4 real test files aren't listed at all. Four of those unlisted tests are **failing**. Real numbers: 407 tests, 403 pass, 4 fail.

**Verified state of the tree**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean — but `tsconfig.json:35` excludes all test files |
| `npx eslint .` | 1 error (`mission-control-dashboard.tsx:128`) |
| `npm test` | 390/390 green — **misleading**, see F5 |
| Actual test state | **407 tests, 403 pass, 4 fail** |
| `npx next build` | fails in sandbox only (no network for Google Fonts) — not a project bug, but see L4 |

---

# CRITICAL

## C1 — The Human Review Gate is bypassed every hour by the autopilot cron

`AGENTS.md` §3: *"The Review Gate is mandatory. No live publishing without human review. Etsy/Printify integration must create draft listings only until a human explicitly approves publication."*

This is not true in code. Full chain, every hop verified:

**`vercel.json:19`** — `{"path": "/api/cron/shop-autopilot", "schedule": "0 * * * *"}` (hourly)

**`src/lib/ajax/autopilot/service.ts:1095-1099`**
```ts
// Self-clear the gate: autonomously review the oldest pending item so the
// factory never freezes waiting on a human.
const cleared = await autoReviewPending(supabase, userId, {
  reviewId: null,
  act: true,          // hardcoded — no env flag, no operator check
});
if (cleared?.acted) { … if (cleared.postApproval) await runPostApproval(cleared.postApproval); }
```

→ **`src/lib/review/auto-review.ts:106`** — `verdict === "approve" || verdict === "revise"` both route to `approveReview`
→ **`src/lib/review/service.ts:206-208`** — `actor: "ai"` is **logging-only**. Verified: `actor` appears at lines 355 and 358 only, both inside an event message. Nothing gates on it.
→ **`src/lib/review/service.ts:417`** — `runPostApproval` → `publishListingViaPrintify`
→ **`src/lib/ajax/adapters/printify.ts:1169-1181`** — `POST publish.json` with `{title:true, description:true, images:true, variants:true, tags:true}` — **a full live publish.**

Three aggravating details:

- **The manual route is gated; the cron is not.** `/api/ajax/review/ai-review` correctly checks `AI_REVIEWER_AUTONOMOUS`. The cron path ignores it entirely.
- **"Revise" counts as approve.** The block comment at `service.ts:1092` says *"autonomous 'revise' counts as reject"* — the implementation at `auto-review.ts:106` does the opposite. The comment is stale and actively misleading.
- **The docstring lies.** `service.ts:409` describes `runPostApproval` as *"creates the Etsy DRAFT listing."* It publishes. Meanwhile `repair-listing/route.ts:60` states plainly *"Publish can flip the Etsy listing live."* The codebase knows.

**The only kill switch is `AUTOPILOT_DISABLED`**, which disables the entire autopilot including all maintenance — and it is not in `.env.example` (see M9), so it's undiscoverable.

**Scenario:** Forge builds a product at 02:10. At 03:00 the cron fires, the AI reviewer grades it 86/100, Printify publishes it to Etsy, and personalization + shipping profile + gallery are attached. You see it for the first time as a live listing.

**Fix**
```ts
act: process.env.AUTOPILOT_AUTONOMOUS_REVIEW === "true",   // default OFF
```
Better: make `actor` load-bearing — let the AI grade and *reject* freely, but require `actor === "human"` to reach `runPostApproval`. Fix the two stale comments while you're in there.

---

## C2 — Unauthenticated Etsy webhook spends real money and ships physical goods

**`src/app/api/webhooks/etsy-orders/route.ts:59-70`**
```ts
const webhookSecret = process.env.ETSY_WEBHOOK_SECRET?.trim();
if (webhookSecret) {                      // ← unset means NO verification at all
  const signature = req.headers.get("x-etsy-signature") ?? …;
  if (!verifyEtsyWebhookSignature(rawBody, signature, webhookSecret)) return 401;
}
```

`.env.example:28` ships `ETSY_WEBHOOK_SECRET` **blank**. Empty string is falsy, the block is skipped, and the handler proceeds under `createServiceClient()` — RLS fully bypassed.

Traced blast radius:

1. `resolveOperatorUserId` (`order-processor.ts:75`) attributes the payload **to you** via `auth.admin.listUsers()`.
2. `insertOrderFromWebhook` (`:157`) writes an `order_queue` row with attacker-supplied photo URL, style prompt, quantity, and full shipping address.
3. → `runPersonalizationAgent` → a **paid** OpenAI `images.edit` call.
4. → `printify.uploadArtwork` → `createProduct` → **`submitOrder`** (`printify.ts:1234`) — a real, billable Printify fulfillment order on your payment method.

`quantity` is copied verbatim with **no upper bound** (`order-types.ts:339`), and dedupe is keyed on the attacker-chosen `receipt_id`, so incrementing it loops forever.

```
POST /api/webhooks/etsy-orders
{"receipt_id":"90000001",
 "personalization":{"photo_url":"https://attacker.tld/x.png","style":"watercolor"},
 "transactions":[{"listing_id":"<any listing>","quantity":500}],
 "shipping_address":{"name":"A B","first_line":"1 Attacker Rd","city":"X","zip":"11111","country_iso":"US"}}
```

**Fix:** fail closed — `if (!webhookSecret) return 503` before any processing. Bound `quantity` (`Math.min(qty, 10)`). Rate-limit per IP. This is the exact opposite of the pattern `octane-engineer/route.ts:14` already gets right (500s when its secret is missing).

---

## C3 — Live orders can ship to `123 Demo Street`

**`src/lib/ajax/pod/order-types.ts:409-423`**
```ts
/** Demo shipping used when Etsy payload omits address (local dev only). */
export function demoShippingForOrder(_etsyOrderId: string): EtsyOrderShippingInfo {
  return { firstName: "Demo", lastName: "Customer", email: "demo@octane-ajax.local",
    country: "US", region: "CA", address1: "123 Demo Street", city: "Los Angeles", zip: "90001", … };
}
```

"local dev only" is enforced **nowhere**. Verified callers — both are live paths, neither is guarded:

- `order-processor.ts:195` — `extractShippingFromWebhook(payload) ?? demoShippingForOrder(...)`, inside `insertOrderFromWebhook`
- `order-fulfillment.ts:101` — the same fallback again at production-submit time

`extractShippingFromWebhook` (`order-types.ts:382`) returns `null` if **any one** of `first_line`, `city`, `zip`, `country_iso` is blank — straight off Etsy's receipt with no validation.

**Scenario:** a receipt returns with `country_iso` empty (scope change, payload drift — this repo has already been bitten by several). The fake address is written to `order_queue.metadata.etsyShipping`. Later `resolveShippingFromOrderMetadata` re-reads it, sees four non-empty strings, and accepts it. Printify bills production + shipping, a mug ships to 123 Demo Street, the buyer opens a case. Nothing logs, nothing alerts.

Note: `order-fulfillment.test.ts:64` asserts the fallback returns the Demo object — that test covers the pure function in isolation and **locks the bug in** rather than catching it.

**Fix:** on the live path, missing address fields must move the order to `failed` for manual review. Gate `demoShippingForOrder` behind an explicit demo flag and refuse `submitOrder` when shipping came from it.

---

# HIGH

## H1 — All 7 cron routes fail open when `CRON_SECRET` is unset

Identical pattern, verified in all seven:

`cron/run-nova:22` · `cron/shop-autopilot:24` · `cron/war-room:17` · `cron/etsy-analytics:20` · `cron/video-jobs:15` · `cron/daily-guide:15` · `ajax/etsy-attributes:27`

```ts
const cronSecret = process.env.CRON_SECRET;
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) return 401;
```

`.env.example:108` ships `CRON_SECRET=` blank. Unset → no auth → the route still proceeds to `createServiceClient()` and `auth.admin.listUsers()` to impersonate you. These are the exact public paths listed in `vercel.json`.

`curl https://<app>/api/cron/shop-autopilot` in a loop runs `runShopAutopilot` (`maxDuration = 800`), which audits and mutates live listings, regenerates artwork, and produces new products — LLM + gpt-image + Printify + Etsy writes on your keys.

**Fix:** invert the guard in all seven, and use a timing-safe compare:
```ts
if (!cronSecret) return NextResponse.json({ok:false, error:"CRON_SECRET not configured"}, {status:503});
const expected = Buffer.from(`Bearer ${cronSecret}`), got = Buffer.from(authHeader ?? "");
if (got.length !== expected.length || !timingSafeEqual(got, expected)) return 401;
```
Extract it into one `withCronAuth(handler)` — see M11, the same 25-line block is copy-pasted seven times and has already drifted.

---

## H2 — `npm test` is green over a suite that silently skips files, and 4 tests are failing

Two independent gaps, and they compound.

**(a) `node --test` silently drops nonexistent paths.** Verified experimentally on Node 22.22.2:
```
node --test ok.test.mjs nope.test.mjs   → exit 0, no warning, missing file never mentioned
node --test nope.test.mjs               → exit 1, "Could not find"
```
The error only surfaces when *every* path is missing. `package.json:8` lists 54 explicit paths; **3 point at files that no longer exist** (`pdf-generator.test.ts`, `pdf-service.test.ts`, `structure-to-document.test.ts` — deleted along with their sources). The script has been short 3 files and cannot tell you.

**(b) 4 test files exist and are never listed:**

| File | Status |
|---|---|
| `src/lib/store/gumroad-url-route.test.ts` | **4 tests FAILING** |
| `src/lib/ajax/printify-placement.test.ts` | passes — real value, should run |
| `src/lib/product/mockup-generator.test.ts` | passes — tests dead code |
| `tests/product-brain.test.mjs` | passes — tests an abandoned directory |

Verified by running them: `# tests 17 / # pass 13 / # fail 4`.

All four failures are `expected X, actual 401`, caused by the test's own mock at `gumroad-url-route.test.ts:98`:
```ts
user: seed.userId ? { id: seed.userId } : null,
```
Every test but `"requires auth"` calls `createMockSupabase({})`, so the mock returns a null user and the route correctly 401s before reaching the logic under test. **The route is fine — the test is broken**, and has been since it was written, because nothing ever ran it.

**(c) The compounding factor:** `tsconfig.json:35-38` excludes `**/*.test.ts` from type-checking. So a clean `tsc --noEmit` says nothing about test files either. Between the silent skip and the exclusion, these four files were invisible to *both* gates.

**Fix:** glob it so deletion and addition are self-correcting (Node 22 supports this natively):
```json
"test": "node --import tsx --test \"tests/**/*.test.mjs\" \"src/**/*.test.ts\""
```
Then fix the mock helper (`seed.userId ?? "user-1"`), and add a `tsconfig.test.json` that includes tests, run in CI.

---

## H3 — The Etsy token refresh guard is dead code; concurrent refreshes can permanently break Etsy

**`src/lib/ajax/etsy-auth.ts:341, 376`**
```ts
const REFRESH_BUFFER_MS = 60 * 60 * 1000;              // 3,600,000 ms
…
if (expiresAtMs - Date.now() > REFRESH_BUFFER_MS) return row;   // never taken
```

Etsy tokens are `expires_in = 3600`, and `expiresAtFromTokenResponse` stores `now + 3600s`. So immediately after a refresh, `expiresAt - now` is *slightly less than* 3,600,000 and never exceeds it. **The early return is unreachable — every call does a full OAuth refresh.**

17 call sites across 16 files, including **once per job inside the video drain loop** (`video/jobs.ts:117`, batches of 10).

Etsy rotates the refresh token on every exchange. Two concurrent refreshers read the same stored token R and both exchange it: one gets `invalid_grant`, or both succeed and the last `UPDATE` wins, discarding the other's pair. Once the stored refresh token diverges from Etsy's current one, **every Etsy operation fails permanently** until you manually reconnect. There is no retry, no alert, and nothing in the UI that says "Etsy disconnected."

Overlap is easy: `etsy-analytics` at 06:00, `etsy-attributes` at 06:45, `shop-autopilot` hourly, `video-jobs` every 10 min.

**Fix:**
1. `REFRESH_BUFFER_MS = 5 * 60 * 1000` — reuse a valid token for ~55 min. Removes most of the exposure by itself.
2. Make the write conditional: add `.eq("refresh_token", row.refresh_token)`; on 0 rows affected, re-read and use the winner's token instead of throwing.
3. Hoist the credential fetch out of the per-job loop at `jobs.ts:117`.

---

## H4 — Personalized orders die in `processing_artwork` with no reclaim

**`src/lib/ajax/pod/order-processor.ts:581`** — the last remaining plain fire-and-forget in the repo:
```ts
export function scheduleOrderProcessing(supabase, userId, orderId): void {
  void (async () => { … await processOrderQueueEntry(…) … })();
}
```

Called from `webhooks/etsy-orders/route.ts:83` immediately before the response returns, and from `order-intake.ts:186` inside `runShopAutopilot`. On Vercel the instance freezes once the Response is sent — the in-flight personalization dies mid-`await`.

**And there is no staleness reclaim.** Verified across every reference: nothing anywhere resets a stale `processing_artwork` row. `order-processor.ts:363` just returns *"Personalization is already in progress."* forever.

This is the sibling-copy pattern again. `generation-pod-runner.ts:295-302` documents the exact fix — *"Uses Next's `after()` so the work survives on Vercel serverless… a plain fire-and-forget promise would be frozen with the lambda"* — and applies it in three places. The one place it wasn't applied is the paid-customer-order path.

**Scenario:** buyer orders at 02:14. The 03:00 pass queues it, flips to `processing_artwork`, starts a 60-240s gpt-image edit, then the autopilot finishes and the lambda freezes. The row is stuck forever. The 04:00 pass re-scans, `insertOrderFromWebhook` returns `duplicate: true`, so it is **never retried**. The Personalization Bay shows "Rendering" indefinitely. The paid order never ships.

**Fix:** wrap both call sites in `after()` with the same `try { after(job) } catch { void job() }` fallback `generation-pod-runner.ts:340` already uses — and `await` it on the cron path, which has budget. Add a staleness reclaim (`order_queue` already has an `updated_at` trigger). Add an autopilot phase surfacing any non-terminal order older than 1h.

---

## H5 — Multi-item orders: everything after the first personalized item is silently dropped

**`src/lib/ajax/pod/order-intake.ts:131-134`**
```ts
const personalized = perTx.filter((p) => p.text);
if (personalized.length === 0) continue;
summary.personalized += 1;
const first = personalized[0]!;      // ← only the first, ever
```

One `order_queue` row per **receipt**, carrying only `personalized[0]`. And it can never be topped up: `migrations/20260605100000_order_queue.sql:26` declares `unique (user_id, etsy_order_id)` keyed on the receipt id, so a second row for the same receipt is rejected as a duplicate on every future pass.

**Scenario:** buyer orders a personalized mug for "Luna" and a personalized bandana for "Rocky" in one checkout — $24.99 + $14.99. Only the mug is produced. `summary.personalized` counts *receipts*, so your report shows nothing wrong. Buyer gets half their order. Multi-item carts are the norm for gift shoppers.

**Fix:** loop over `personalized`, one row per transaction; key the constraint on `(user_id, receipt_id, transaction_id)`.

---

## H6 — The buyer's size/color choice is never read — every order ships variant #1

**`src/lib/ajax/pod/order-fulfillment.ts:221-223`**
```ts
const variantId = podDetails.variantIds[0] ?? DEFAULT_POD_DETAILS.variantIds[0]!;
```

`podDetails.variantIds` is the **listing's** static catalog array, not anything from the order. Verified every extraction path: `extractPersonalizationFromWebhook` (`order-types.ts:312`) matches only `photo/image/upload/picture` and `style/aesthetic/art`; `personalizationTextFromVariations` (`order-intake.ts:44`) matches only `/personal/i`. **Nothing reads a Size or Color variation.**

Multi-variant is the norm here — `printify-catalog.ts:100` is `variantIds: [18052…18056], // Aqua S–2XL`.

**Scenario:** buyer orders the tee in 2XL and pays the $31.99 upcharge (`variantPrices: {18056: 3199}`). Printify produces `18052` = Size S. Wrong garment, reship, double production cost, a size complaint in the reviews. Every non-first-variant order is wrong.

**Fix:** extract the size/color variation from `transactions[].variations[]` — the same mechanism already used for photo/style — map it to the matching id, and fall back to `[0]` only when nothing matches.

---

## H7 — Pricing: no catalog authority, a compounding reprice endpoint, and a swallowed sync failure

Three separate defects on one path. Your own note confirms the first one from the merchandising side.

### (a) Price is not derived from product type — Forge freelances it per listing

There is no catalog-authoritative pricing gate at product-creation time. `printify-catalog.ts` carries `variantPrices`, but nothing asserts that a created product matches them, so per-concept LLM judgment produced the $39.99 / $42.99 / $44.99 sweatshirt spread. **A one-time normalization pass will not hold** — the next Forge run re-opens it. The durable fix is an assertion at creation, not a cleanup.

### (b) `reprice-and-returns` is a non-idempotent GET that compounds 1.33× per fire

**`reprice-and-returns/route.ts:29,30`** — `const SALE_MULTIPLIER = 1 / 0.75;` … `export async function GET()`
**`printify.ts:749-755`** — reads the **current live price** and multiplies:
```ts
const charmUp = (cents: number): number => {
  const raw = cents * multiplier;
  const dollars = Math.ceil(raw / 100);
  …
```

No run-once marker, no `repriced_at`, and it's a `GET`. The $24.99 mug: run 1 → **$33.99**, run 2 → **$45.99**, run 3 → **$61.99**.

Re-firing is easy — a refresh, a prefetch, a platform retry, or you deliberately re-running it, which the route actively invites: `:119` does `if (failed.length >= 3) break;`, abandoning the pass partway and reporting failures, so the natural "finish the job" response re-inflates everything that already succeeded.

**Before normalizing, audit live prices against expected** — if this was re-fired at any point, some listings are already a step higher than you think.

### (c) `raiseVariantPrices` swallows the Etsy sync failure and reports success

**`printify.ts:785-810`**
```ts
if (!putRes.ok) throw new Error(`Printify price update failed (${putRes.status}).`);   // correct
const pubRes = await fetchImpl(`…/publish.json`, { … variants: true … });
if (pubRes.ok) { await fetchImpl(`…/publishing_succeeded.json`, …).catch(() => undefined); }
return liveResult("Variant prices raised.", { productId, variants: changes });          // always success
```

The price `PUT` throws on failure; the **publish that actually pushes the price to Etsy does not**. `publishProduct` at `:1183` in the same file *does* check this — the check was dropped only here.

On a 429/500 during publish, Printify shows $33.99 and Etsy still shows $24.99. The route counts it in `repriced`, lists it in `examples`, and writes the new price into the DB at `route.ts:113`. Your 25%-off sale keeps selling at **$18.74** while every internal record insists the margin fix landed.

### Fixes
- Add `setVariantPrices(productId, targetsByVariantId)` — **absolute** per-variant targets from the catalog, not a multiplier. Use this for normalization; the multiplier path is the wrong contract for it.
- Make the reprice route `POST`; persist a per-listing target marker and skip already-processed rows.
- `if (!pubRes.ok) throw` — mirror `publishProduct`.
- Add a hard assertion at `createProduct` that price matches the catalog for that product type, so Forge can't freelance.

---

## H8 — The margin formula ignores absorbed shipping and every Etsy fee

**`src/lib/ajax/product-brain/market-signals.ts:174-190`**
```ts
/** Margin from retail price vs estimated POD cost (POD winners keep >50%). */
function scoreMargin(priceUsd, podCost) {
  const gross = (priceUsd - podCost) / priceUsd;
  if (gross >= 0.6) score = 95; …
```

`podCost` is a bare blank-cost estimate (`POD_BASE_COST`, `:72` — `mug: 8`). Missing: Printify shipping (now fully absorbed on US orders per commit `15820d1`), Etsy transaction fee 6.5%, payment processing 3% + $0.25, listing fee $0.20.

Using the code's own numbers — mug, `podCost = 8`, retail $24.99:

| | Margin |
|---|---|
| What the code computes | `(24.99 − 8) / 24.99` = **68%** → score 95, and it prints *"Retail $24.99 vs ~$8 POD cost → 68% margin"* to you |
| Actual | 24.99 − 8.00 − ~4.75 shipping − 1.62 (6.5%) − 1.00 (3%+$0.25) − 0.20 = **$9.42 ≈ 37.7%** |

A ~30-point overstatement that rates as "excellent" something failing its own stated >50% bar. It drives idea selection (weight 0.15 at `:263`) and the rationale text you read.

Compounding: `reprice-and-returns` **fetches Printify's true per-variant `cost`** (`printify.ts:767`) and surfaces it as `productionCost` — but never compares it to price. There is **no profit guardrail anywhere** in the create or reprice path. And `store-tune/route.ts:236` only flags a listing below $12.99 — at $12.99 with free shipping a mug is underwater before the first fee.

**Fix:** `(price − blankCost − shipping − 0.065·price − 0.03·price − 0.25 − 0.20) / price`, with per-format shipping constants. Add a hard assertion in `createProduct` / `setVariantPrices` that `newPrice × 0.75 > cost + shipping + fees`.

---

## H9 — `fixPrintPlacement` regresses products that were already correct

`createProduct` learned this lesson and documented it — **`printify.ts:667-701`**:
```ts
// ONE placement serves EVERY enabled variant, but the panel aspect differs
// per size (bp1672 bandana: S is 1.76:1, XL is 1.94:1). Fitting only
// variantIds[0] clipped the art on the other sizes — the 2026-07-22 bandana
// wave failed vision QA on exactly that. Use the TIGHTEST fit across all variants.
const dimsList = await Promise.all(variantIds.map(…));
const scale = Math.min(...aspects.map((a) => fitScale(aspect, a)));
```

The function whose entire job is repairing that defect never got the fix — **`printify.ts:1070-1077`**:
```ts
const dims = await getPlaceholderDims({
  blueprintId, printProviderId: providerId,
  variantId: area.variant_ids[0],     // first variant only
  position, apiToken: token, fetchImpl,
});
```

Bandana (`printify-catalog.ts:126`), print areas per its own verified comment — S 1.758, M 1.682, XL 1.936; true art aspect 1.5:

- Correct (min across all three): scale **0.6588** → XL fills 85.0% of print height, the intended margin
- Buggy (S only): scale **0.7252** → XL fills **93.6%**, less than half the safety margin

Worse: running the repair on an already-correct product **raises** 0.6588 → 0.7252, a delta that trips the `> 0.02` change threshold at `:1100`, so it *will* PUT the worse placement. The repair tool re-introduces the defect it exists to remove.

**Fix:** fetch dims for every id in `area.variant_ids` and take the min `fitScale`, identical to `createProduct`.

---

## H10 — Any authenticated user can mutate your live Printify shop

`repair-poster:45` · `repair-listing:47` · `repair-video:38` · `rebuild-gallery:163` · `printify-map:27` · `run-forge:25`

```ts
// repair-listing/route.ts:47-58
const productId = body.printifyProductId.trim();
const printify = createPrintifyAdapter();
const fix = await printify.fixPrintPlacement(productId);
… await printify.publishProduct(productId);
```

These check `supabase.auth.getUser()` and nothing else. `printifyProductId` comes **straight from the request body, never joined against the caller's own listings**. The adapter uses process-wide env credentials (`printify.ts:267`) — there is exactly one shop, yours. So "authenticated" and "authorized to touch this product" are conflated, and there is **no operator allowlist anywhere** (`grep OPERATOR_EMAIL` matches only cron routes and the webhook). Signup is browser-reachable at `auth-form.tsx:38`.

Chain: register → `GET /api/ajax/printify-map` enumerates every product + its Etsy listing id → `POST /api/ajax/repair-poster` runs a paid OpenAI edit and swaps the artwork → `POST /api/ajax/repair-listing {"publish":true}` republishes the corrupted art to Etsy.

The Etsy-side calls in these routes *are* gated (they go through `refreshEtsyToken(user.id)`, null for a user with no credentials). The **Printify side is not gated at all**, and `repair-listing` reaches Etsy indirectly through Printify's channel binding, bypassing that gate.

*Caveat, stated honestly:* if signups are disabled in the Supabase dashboard, this needs an existing account. The missing authorization is a defect either way.

**Fix:** a shared `requireOperator(user)` comparing `user.email` to `OPERATOR_EMAIL`, called in every `/api/ajax/*` route. Separately, resolve `printifyProductId` from a row owned by `user.id`.

---

## H11 — Zero timeouts and zero 429 handling on every Etsy and Printify call

**`etsy.ts:265`** and **`printify.ts:588`** — `const fetchImpl = options.fetchImpl ?? fetch;`

All ~30 `fetchImpl(...)` calls in `etsy.ts` and ~20 in `printify.ts` are issued with **no `signal`, no `AbortSignal.timeout`**. Verified negative: `grep -rn "429\|Retry-After\|rate.?limit" src` returns exactly **one** hit repo-wide — `llm/json.ts:78`, a substring check on an OpenAI message. No retry, no backoff, no 429 branch anywhere in the Etsy or Printify path.

Node's `fetch` has no default timeout. One hung Etsy connection mid-pass blocks indefinitely, sails past the 600s soft budget check (only consulted at `:592` and `:840`, both *after* the audit loop), and is hard-killed by Vercel at 800s. No `autopilot_summary` event is ever written — you get no record of what happened.

`fetchImageAsBase64` (`printify.ts:464`) additionally buffers an unbounded remote image via `arrayBuffer()`, as does the MP4 fetch at `video/jobs.ts:121`.

**Fix:** wrap both adapters' `fetchImpl` — `AbortSignal.timeout(20_000)` plus a retry wrapper for idempotent GETs and 429/5xx honoring `Retry-After`, capped at 3. **Do not** blanket-retry POSTs (`createDraftListing`, `submitOrder`, `uploadListingVideo` are not idempotent) — timeout only. Check `content-length` before `arrayBuffer()`.

---

## H12 — Review approval is a read-then-write with a multi-second vision call inside the race window

**`src/lib/review/service.ts:209`** (read, 409s if not pending) … **`:311-320`** (write):
```ts
.update({ status: "approved", reviewed_at: now })
.eq("id", reviewId)
.eq("user_id", userId)          // ← no .eq("status", "pending")
```

Normally a TOCTOU window is microseconds. Here it is **5-30 seconds**, because the vision gate at `:225-286` does a Printify `getProduct` plus an OpenAI `visionCheckProductMockup` in between.

Three actors can hit the same pending review: the hourly cron (C1), the browser's 18-second `autoReviewNext()` poll (`factory-sweatshop.tsx:365`, whose `autoReviewingRef` guard is per-tab and doesn't know about the cron), and the manual Approve button.

Both writers pass, both insert a `content_jobs` row, and **both run `runPostApproval`** → two Printify publishes, two enrich runs, two `enqueueApprovalVideos`. The daily video cap check (`video/jobs.ts:276`) is itself a read-modify-write, so both pass it too: two paid fal renders for one listing.

**Fix:** make the write the lock — add `.eq("status", "pending")` and treat zero rows as a 409, returning without a `postApproval` context. Move the vision gate outside the critical section.

---

## H13 — `drainVideoJobs` has no job claim; three drivers can process the same job

**`src/lib/ajax/video/jobs.ts:170-178`** selects `status = "pending"` with no claim, no lease, no `UPDATE … RETURNING`. The row stays `pending` through the entire Etsy upload and only flips at `:208`.

Three independent drivers, none coordinating: the `video-jobs` cron (every 10 min), the client poll (**every 30s** while the Factory page is open, `tiktok-queue-panel.tsx:174`), and `shop-autopilot` mid-pass (`autopilot/service.ts:800`).

Two full video downloads and two Etsy video uploads for one render, plus two racing token refreshes (H3). `markJob` (`:95`) filters only on `id`, so neither notices. The `attempts` bump at `:185` is a read-modify-write, so `MAX_ATTEMPTS = 60` isn't a reliable ceiling.

**Fix:** add `claimed_at` and claim atomically via an `UPDATE … WHERE status='pending' AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes') RETURNING *` RPC. Add `.eq("status","pending")` to `markJob`. Increment attempts with a SQL expression.

---

## H14 — A transient fal or Etsy error permanently discards a paid render

**`fal-render.ts:207-223`** and **`:240-248`** — a `!statusRes.ok` (429, 502) and a caught `AbortSignal.timeout(15000)` both return `status: "failed"`, identical to a genuine render failure. **`jobs.ts:198-222`** then calls `markJob(…, "failed")`, and `video_jobs.status` has `check (status in ('pending','done','failed'))` with **no path out of `failed`**.

The hardening comment explains the intent ("never let a bad response masquerade as still rendering") — but it conflates *"fal says FAILED"* with *"we couldn't reach fal."*

fal rate-limits the 10-job drain burst; poll #6 returns 429; the job is marked permanently failed. The MP4 finishes and is billed (~$0.35) but is never fetched. The video-freshness medic (`autopilot/service.ts:990`) filters out `failed`, so it eventually re-renders — **paying a second time** — without anyone learning the first was thrown away over a 429.

**Fix:** return a third `"unknown"` state for `!ok` with 429/5xx and for the catch branch; treat it as `pending` (bump attempts). Honor `Retry-After`. In `completeEtsy`, only mark `failed` on 4xx.

---

# MEDIUM

## M1 — The daily attribute cron uses the wrong wire format and writes nothing

**`etsy-attributes.ts:192-193`** — `body.append("value_ids[]", …)` / `body.append("values[]", …)`

Contradicted by both the repo's own spec (`ETSY_ATTRIBUTES_API_SPEC.md:19` — `value_ids=<id>`) and its own sibling (`etsy.ts:785` — bare repeated keys, no brackets).

Runs daily at 06:45 UTC, is designed never to throw (per-property failures land in `skipped[]`), and returns `{ok: true}` regardless. It reports success every day while writing nothing. The spec doc calls these attributes *"the only way a listing shows up in a filtered search"* — this is a standing discoverability leak.

`etsy-attributes.test.ts:82` asserts the bracket form, so the bug is locked in by a passing test.

**Fix:** align with `etsy.ts`; update the test.

## M2 — Autopilot permanently skips ~10 of 35 listings

**`autopilot/service.ts:402`** — `liveListings.slice(0, MAX_LISTINGS_PER_PASS)` where `MAX_LISTINGS_PER_PASS = 25` (`:77`) and `DEFAULT_TARGET_LISTINGS = 35` (`:75`). No rotation, no sort. This is the loop that fills tags, fixes shipping profiles, and runs the Medic.

The same file fixed this bug class 400 lines later for the heal batch (`:816-836`, rotating by UTC hour) with a comment explaining that a fixed slice *"silently excluded rows past #24 once the shop hit 30."* The fix was never applied to the earlier, more consequential loop.

**Fix:** apply the same hour-based rotation offset.

## M3 — The autopilot overlap lock expires before the pass it protects

**`autopilot/service.ts:190-213`** — an 8-minute window on an append-only events table, guarding a pass with a 600s soft budget and `maxDuration = 800`. Minutes 8-13 are unprotected. It's also check-then-act with a network round trip between SELECT and INSERT, and it's shared with the manually-triggered `/api/ajax/run-autopilot`.

**Fix:** a real lease — a single-row `autopilot_locks` table with `UPDATE … SET locked_until = now() + interval '15 minutes' WHERE locked_until < now() RETURNING id`, released in a `finally`. Lease ≥ `maxDuration + 60s`.

## M4 — The 90s "stale generation" window is shorter than the job it guards

**`generation-pod-runner.ts:34`** — `STALE_FULFILLMENT_MS = 90_000`, but `runPodFulfillment` legitimately runs far longer: `PRINTIFY_TIMEOUT_MS = 90_000` applied to two calls, plus a gpt-image generation at `IMAGE_GENERATION_TIMEOUT_MS = 240_000` (possibly twice), plus two vision checks, plus 3×15s mockup polling. `updated_at` is written once at `:146` before the work begins and never touched again, so a healthy job looks "stale" from T0+90s for the remaining several minutes.

A page refresh at T0+95s starts a **second** full fulfillment: a second paid image generation and a second Printify product, one of which ends up orphaned and billed.

**Fix:** raise the window above the true worst case (~12 min) **and** heartbeat `updated_at` between steps. Make the claim atomic with `UPDATE … WHERE id = $1 AND (status <> 'generating' OR updated_at < $stale) RETURNING id`.

## M5 — Open redirect on the auth callback and the login form

**`src/app/auth/callback/route.ts:8,14`** — `const next = searchParams.get("next") ?? "/factory"` … `NextResponse.redirect(\`${origin}${next}\`)`
**`src/components/auth/auth-form.tsx:14,71`** — same, then `router.push(next)`

Neither validates. String-concatenating onto `origin` is not a same-origin guarantee. Verified in Node:

| `next` | resulting host |
|---|---|
| `@evil.com` | **evil.com** |
| `/factory` | octane-ajax.vercel.app |
| `//evil.com` | octane-ajax.vercel.app (safe here) |

`…/auth/callback?code=<valid>&next=@evil.com` sets the session cookie on the legitimate origin and *then* lands the victim on evil.com — reads as a successful login immediately before the attacker's page. The `/login?next=https://evil.com` variant bounces the operator externally right after they type their password.

The middleware *does* validate `next` via `isProtectedPath` (`middleware.ts:19`) — but only on the `pathname === "/login" && user` branch. It never runs for `/auth/callback` and doesn't constrain `AuthForm`'s own push.

**Fix:** reuse the existing helper in both places — `raw.startsWith("/") && !raw.startsWith("//") && isProtectedPath(raw) ? raw : "/factory"`.

## M6 — `ajax_agents` RLS is `using (true)` for all authenticated users

**`migrations/20260516120000_init_octane_ajax_schema.sql:212-235`** — all four policies (select/insert/update/delete) are `to authenticated using (true) with check (true)`. The comment says "shared read/update for demo," but this is the production migration and the table holds the live agent registry.

Any authenticated user can `PATCH` PostgREST directly. `ajax_tasks.agent_slug` and `factory_events.agent_slug` are `on update cascade`, so a slug rename silently rewrites history across the whole factory, and `AGENT_SLUGS` in `schema.ts:2` hardcodes the originals — so `updateAgentState` starts throwing on every pipeline step.

**Fix:** keep `for select … using (true)`; drop insert/update/delete (server routes can use the service client).

## M7 — Four production tables have no migration

`schema.ts:116,135-137` references `businesses`, `affiliate_guides`, `affiliate_links`, `affiliate_clicks`. All four exist in `database.types.ts` (so they exist in the live DB) but **no migration creates them** — and therefore no migration enables RLS or defines a policy. Postgres defaults RLS to **off**; Supabase only auto-enables it for tables created through the Table Editor UI.

Corroborating drift: `product_listings.Insert` in `database.types.ts:421` includes `business_id`, a column no migration adds; several migrations carry *"Applied to production via Supabase MCP"* comments.

If `affiliate_links` has RLS off, the anon key grants full write, and `/go/[slug]` (service client, unauthenticated by design) becomes an open redirector under your domain.

The defect is that **the security posture of four production tables is not in version control.**

**Fix:** add a migration enabling RLS + per-user policies for all four; run `supabase db diff` against production; add a CI check that every table in `database.types.ts` appears in a migration.

## M8 — Unauthenticated SSRF with unbounded buffering via the webhook photo URL

`order-types.ts:172-182` (`isValidCustomerPhotoUrl` — checks **scheme only**) → `image-generator.ts:249-254` (`fetchImpl(url)` then `arrayBuffer()`, no timeout, no size cap). Reachable from the unauthenticated webhook of C2.

- `http://169.254.169.254/latest/meta-data/` — server-side request to cloud metadata. Blind, but error text differs between reachable and unreachable hosts, giving an internal host/port oracle via `order_queue.error_message`.
- `https://attacker.tld/10gb.bin` — buffers into the lambda heap with no ceiling.

Same pattern authenticated at `rebuild-gallery/route.ts:249` (that one has a 15s timeout, still no size cap or host allowlist).

**Fix:** require `https:` + a CDN hostname allowlist; add `AbortSignal.timeout(15_000)`; reject `Content-Length > 10MB`; reject private/loopback/link-local IPs.

## M9 — 31 env vars are read in code and documented nowhere

Verified by diffing `process.env.X` across `src/` + `scripts/` against `.env.example`: **67 read, 31 undocumented.** The notable ones:

| Var | Read at | Why it matters |
|---|---|---|
| `AUTOPILOT_DISABLED` | `autopilot/service.ts:182` | **The kill switch for the hourly autopilot.** Undiscoverable. |
| `AI_REVIEWER_AUTONOMOUS` | `review/ai-review/route.ts:33` | Gates AI auto-approval without a human |
| `AI_REVIEWER_APPROVE_THRESHOLD` / `_REJECT_THRESHOLD` | reviewer | Tunes that gate |
| `AUTOPILOT_TARGET_LISTINGS`, `AUTOPILOT_NOVA_FREE_RUN` | autopilot | Scope of autonomous production |
| `GOOGLE_API_KEY` | `llm/providers.ts:44` | LLM failover silently dark without it |
| `PUBLIC_SITE_URL` | `affiliate/guide-writer.ts:202` | Falls back to a hardcoded vercel.app host — every affiliate link wrong on a custom domain |
| `TAKEDOWN_*` (4), `SOCIAL_*` (7), `AYRSHARE_*` (3), `VIDEO_DAILY_RENDER_CAP`, `VISION_QA_MODEL`, `TREND_RESEARCH_MODEL`, `LLM_FALLBACK_*` (2), `AFFILIATE_*` (2) | various | Behavior and cost flags |

Reverse direction — 4 stale entries documented but never read: `IMAGE_GENERATOR_API_KEY`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.

You cannot discover your own kill switch from the file whose job is to list it.

**Fix:** add all 31 with a one-line comment and default; delete the 4 stale. Consider a `src/lib/env.ts` zod schema so it can't drift again.

## M10 — Nothing tells you when a 3am cron fails, and some failures report as success

Verified negative: `grep -rn "sendEmail\|slack\|notifyOperator\|Sentry\|alert(" src` → **zero results**. No alerting, no dead-letter, no failure surface in the UI. The only record is `factory_events` rows and Vercel logs.

Three places where failure is actively reported as success:

**(a) A dead Etsy connection reports as "shop is healthy."** `autopilot/service.ts:216-221` catches the `refreshEtsyToken` failure into `credentials = null` and pushes **nothing** to `result.errors`. Every Etsy phase is gated on `if (credentials)`, so the pass does nothing, then `:1170` writes *"audited 0 listing(s) — shop is healthy, no action needed"* and returns HTTP 200. Combined with H3, the most likely way for Etsy to break is also the way that produces the most reassuring log line.

**(b) A locked Printify product reports as published.** `printify.ts:1191-1201` never inspects the `publishing_succeeded` response (`:805` does the same with an explicit `.catch(() => undefined)`). Printify locks a product on `publish.json` and only unlocks on succeeded/failed; neither `is_locked` nor `publishing_failed` appears anywhere in `src`. If that POST 429s, the product stays locked forever while the listing row is written as `published`.

**(c) Every cron returns 200 on partial failure.** `runShopAutopilot` accumulates into `result.errors` (25+ push sites) and the route returns 200 regardless. Vercel's cron dashboard shows a green check for a pass that errored on 13 of 25 listings.

**Fix:** push the credential failure into `result.errors` and gate the "healthy" wording on `credentials != null`. Check `publishing_succeeded`; on failure POST `publishing_failed.json` to release the lock and throw. Return `ok: false` / 500 when `errors.length > 0`. Add one `system_alerts` table + a Mission Control banner fed by: passes with errors, orders non-terminal > 1h, failed video jobs, failed generations. That single surface catches H4, H14, and M10(a).

## M11 — Duplication that has already drifted

- **`configReady()` copy-pasted 12×** while the canonical `isSupabaseConfigured()` (`lib/auth/env.ts:2`) is used by only 3 pages. All 12 are byte-identical today; add a third required env var and you must find 13 sites, and 3 will silently disagree with 12.
- **Cron auth block reimplemented 7×** while `resolveOperatorUserId` (`order-processor.ts:75`) has exactly one caller. Already drifted — `run-nova:29` says *"OPERATOR_EMAIL env var not set. Add your login email to Vercel env vars."*, the other six say *"OPERATOR_EMAIL env var not set."* One `withCronAuth(handler)` deletes ~150 lines and single-sources H1's fix.
- **`showToast` duplicated 5×**, same latent bug in each: `window.setTimeout(… , 6000)` never cancelled, so three toasts in quick succession clear the third early, and it fires after unmount. Already drifted on memoization — 3 wrap it in `useCallback`, 2 don't.
- **No shared `requireUser`** — 48 routes hand-roll the same 8 lines; 61 separate `status: 401` blocks; `grep requireUser|withAuth|getSessionUser` → 0 results.

## M12 — Query and index gaps

- **No index on `product_listings.gumroad_product_id` or `external_listing_id`** — verified absent across all 21 migrations. Filtered on four hot paths: `order-processor.ts:116` (every order webhook), `order-fulfillment.ts:116`, `autopilot/service.ts:263` (hourly), `analytics/etsy-snapshots.ts:113` (daily). Also missing: `order_queue.listing_id`, `listing_performance_snapshots.listing_id`, `video_jobs.etsy_listing_id`.
- **Unbounded public storefront query** — `public-queries.ts:74` has `.eq("status","published").order(…)` with **no `.limit()`**, called from a `force-dynamic` page, unauthenticated and uncached, re-run per page view on the growth table.
- **Mission Control LLM cost always displays 0** — `mission-control/route.ts:101` filters `llm_usage_log` by `.eq("user_id", userId)`, but `usage-logger.ts:22` never sets `user_id` on insert. `NULL = uuid` is never true. `getWeeklyLlmCostUsd` in `revenue-queries.ts:136` correctly omits the filter — another drift. Drop the `.eq()`.
- **N+1 in `fetchTopOperatorSeed`** (`simulator.ts:885`) — a COUNT per candidate in a loop; the correct `.in()` batch pattern exists 30 lines away at `:248`.

## M13 — `.json()` before `.ok` on the Printify money path

`printify.ts:622` (`uploadArtwork`), `:719` (`createProduct`), `:1243` (`submitOrder`):
```ts
const payload = (await response.json()) as PrintifyUploadResponse;
if (!response.ok || !payload.id) throw new Error(`… (${response.status}): …`);
```
On an HTML 502/503 or empty body, `.json()` throws `SyntaxError: Unexpected token '<'` **before** the `.ok` check — so the status-carrying error you wrote for exactly this case never fires, and you get an opaque parse error instead. Hits every product creation and every order submission.

**Seven other methods in the same file** check `.ok` first, and `etsy.ts:223` (`parseEtsyJson`), `gumroad.ts`, and `lemonsqueezy.ts` all implement the correct helper. Same bug at `llm/providers.ts:156` and `:204`.

## M14 — ~1,600 lines of dead code

Confirmed dead (zero non-test callers, each verified by grep):

| What | Lines |
|---|---|
| `src/lib/product-brain/` — an **abandoned parallel implementation** of the live `src/lib/ajax/product-brain/`. `grep "@/lib/product-brain"` → 0 hits. Its only "user" is `tests/product-brain.test.mjs`, itself one of the 4 orphan tests from H2 — a dead test asserting against a dead module, invisible to the runner. | ~330 |
| The **entire v1 factory dashboard subtree** — `factory-dashboard.tsx` + 5 children + `pipeline-room-station.tsx`. `factory/page.tsx:1` renders `<FactorySweatshop>`. Note `tests/demo-workflow.test.mjs` reads two of these as text fixtures, so part of your green suite asserts against unreachable UI. | ~1,000 |
| `factory-vis-map.tsx` — the component is dead (only reference is a comment in `factory-floor-3d.tsx:6`); the file survives only for two type exports. Includes a `setInterval` that will never run. | ~200 |
| 4 dead re-export barrels (`ajax/`, `llm/`, `ajax/pixel/`, `supabase/`), `adapters/tiktok.ts`, `listings/[id]/republish/route.ts`, `isPdfOnlySellabilityBlock` | ~120 |
| Retired PDF/Gumroad plumbing — `review/etsy-on-approve.ts` (252, test-only), `assertPdfReadyForApproval`, `mockup-generator.ts`, `createGumroadAdapter`, `review-structure-preview.tsx` | ~500 |

**On strategy drift specifically:** `AGENTS.md` says PDFs are retired, and the *good* news is the POD path is clean — `pdf-generator.ts` / `pdf-service.ts` / `structure-to-document.ts` are already deleted, `uploadProductPdf` has zero callers, and the only live `product_generations` insert hard-codes `pdf: { storagePath: null }`. **Nothing writes a PDF.** But the plumbing is intact: the `product_pdfs` bucket is still provisioned, `publish-gumroad` and `pdf-download` are still live routes (both permanently 409 because they gate on a PDF that never exists), and the `/operator-store` Gumroad button is reachable by direct URL. Reintroducing the retired line needs **one new caller**, not a migration.

Also: `factory-floor-3d.tsx:778` still tells you on the main `/factory` page that Forge produces *"a print-ready PDF."*

## M15 — Three.js is 66% of the landing route's JS and is never lazy-loaded

`factory-floor-3d.tsx:16` — `import * as THREE from "three";`, a static top-level import. `grep -rn "next/dynamic\|React.lazy" src/` → **zero results** repo-wide.

Good news: Turbopack route-split it — the 584 KB chunk is referenced only by `/factory`'s manifest, not a shared bundle. Bad news: `/factory` is where every login lands (`app/page.tsx:29` redirects there), `FactoryFloor3D` is the *first* child rendered (`factory-sweatshop.tsx:408`), and the route's client JS is ~887 KB total — Three.js is 66% of it, in the hydration-blocking path, delaying the panels and event feed below it.

```tsx
const FactoryFloor3D = dynamic(
  () => import("@/components/factory/factory-floor-3d").then(m => m.FactoryFloor3D),
  { ssr: false, loading: () => <FactoryFloorSkeleton /> },
);
```
`ssr: false` is free — it's a WebGL canvas that renders nothing server-side. Pairs naturally with the `scene.ts` extraction in M16.

## M16 — Three modules need splitting; two don't

Line count is a weak signal. The real metric is **largest single function**.

| Module | Lines | Largest fn | Verdict |
|---|---|---|---|
| `autopilot/service.ts` | 1208 | **1,010** (`runShopAutopilot`, 84% of the file, one export) | **Split.** Easiest in the repo — it already has 13 `// ---- Phase ----` banners. Extract `autopilot/phases/*.ts` each exporting `run(ctx, result)`; `service.ts` becomes ~120 lines iterating a phase array with the budget check between each. Directly retires the biggest test-coverage gap. |
| `adapters/etsy.ts` | 1139 | **881** (`createEtsyAdapter` closure, 25 methods) | **Split** by API resource: `etsy/{client,listings,media,shipping,taxonomy,shop}.ts`. This is also *why* 20 of 25 methods are untested — you can't test `ensureReturnPolicy` without building the whole adapter. |
| `adapters/printify.ts` | 1268 | 674 | Split, lower urgency — the top 480 lines are already well-factored pure helpers, and it has 411 lines of tests. |
| `factory-floor-3d.tsx` | 1038 | 668 (one `useEffect` spans 515) | Split the scene from the React shell → `factory-3d/{scene,rooms,inspector}`. The `[]` deps are *correct* for WebGL — the problem is co-location, not the effect. |
| `simulator.ts` | 979 | 249 | **Leave it.** Genuinely decomposed — 20 functions, 11 small helpers, high cohesion. Its problem is zero tests, not size. |

## M17 — Test coverage gaps on the highest-risk modules

Weighted by risk, with the caveat that several existing tests cover a *helper* next to the risky module rather than the module itself:

| Priority | Module | Lines | Why |
|---|---|---|---|
| **P0** | `pod/order-processor.ts` | 598 | **Zero tests.** The paid-order entry point. Its *downstream* helper has two test files; the thing that calls it has none. |
| **P0** | `review/service.ts` | 537 | **Zero tests.** The gate orchestrator. Its predicates have 571 test lines — but 147 of those are `etsy-on-approve.test.ts`, testing **dead code**. Your review-gate test budget is spent on a module nobody calls while the live gate is untested. |
| **P1** | `adapters/etsy.ts` | 1139 | 25 methods, **5 tested**. Untested: `ensureReturnPolicy`, `createFreeUsShippingProfile`, `addInternationalDestinations`, `setListingPersonalization`, `updateListing`, `getShopReceipts`, `resolveTaxonomyId` — which is almost exactly your last five commits. **The most-churned code is the least tested.** |
| **P1** | `autopilot/service.ts` | 1208 | Zero tests. `autopilot.test.ts` is misleadingly named — it imports from `decisions.ts` and `takedown.ts`, not `service.ts`. |
| **P2** | `printify-publish-on-approve.ts` | 630 | Publish path; runs on every approval + 8×/hour in self-heal |
| **P2** | `simulator.ts` | 979 | `runNovaStep` / `runForgeStep` — the production pipeline |

---

# LOW

**L1 — The one ESLint error is real.** `mission-control-dashboard.tsx:128`, `react-hooks/set-state-in-effect`. Best fix: fetch on the server and pass `initialSnapshot` as a prop, keeping only the 60s interval client-side — you also get SSR content instead of an empty shell. Otherwise a scoped disable with a justification comment, matching what `tiktok-queue-panel.tsx` and `event-feed.tsx` already do. Leaving it as the repo's one standing error trains you to ignore a non-zero lint count.

**L2 — `dashboard-view.tsx` is a 449-line client component with zero interactivity.** Verified: no `useState`/`useEffect`/`useRef`/`useCallback`/`useMemo`/`useRouter` and no event handlers — the grep count is literally 0. Its only browser-ish call is `Date.now()` for relative timestamps, which renders fine server-side. 449 lines shipped and hydrated for nothing. Delete the `"use client"`. `agent-memory-card.tsx` (160 lines) is the same case.

**L3 — Waterfalls and a duplicated query.** `review/page.tsx:30-34` runs two independent queries sequentially. `factory/page.tsx:39-40` awaits `fetchBusinesses` then `getActiveBusiness`, which internally calls `fetchBusinesses` **again** — the identical SELECT runs twice per render (same at `businesses/page.tsx:27`). Derive `active` in memory. The `Promise.all` pattern is already used correctly in `war-room/page.tsx` and `dashboard/page.tsx`; it just wasn't applied consistently.

**L4 — No streaming anywhere.** `(command)/layout.tsx:4` sets `force-dynamic` for all 11 operator pages (technically redundant — `cookies()` already forces it), and `grep Suspense src/` returns exactly one hit. Every navigation blocks on the full server fetch with no loading UI. A `loading.tsx` in `(command)/` plus `<Suspense>` on the heavy pages is near-free.

**L5 — `build-out2.txt` is tracked by git.** `.gitignore` has a blanket `*.txt`, but ignore rules aren't retroactive. `git rm --cached build-out2.txt`. Also tracked: 4 pre-Next prototype HTML files (~185 KB) now superseded by the real app.

**L6 — Nine overlapping plan docs (~87 KB).** Several are superseded by their own titles ("Definitive", "Final Push", "Forward"). Plus `polymarket_research.md` and `research_notes.md`, unrelated to POD. An AI coding assistant will read these and be misled. Keep `README.md`, `AGENTS.md`, and the two Etsy specs at root; move the rest to `docs/archive/`.

**L7 — `tsconfig` hardening.** `strict: true` is on, but `noUncheckedIndexedAccess` is off — it would have caught several array-index `!` assertions at compile time. `target: "ES2017"` is dated for Node 22.

**L8 — Build depends on network access to Google Fonts.** `next/font/google` fetches `Geist` and `Geist Mono` at build time; the build hard-fails when they're unreachable. Self-host via `next/font/local` to make builds hermetic.

**L9 — Minor hardening.** `octane-auth.ts` — a missing `payload.timestamp` makes both replay checks `NaN > x` → `false`, skipping replay protection (not exploitable — the signature covers the payload — but add `if (typeof payload.timestamp !== "number") return false`). `supabase/server.ts` lacks `import "server-only"` despite the "never import in client code" comment; peers like `affiliate/links.ts` have it. `update-listing-seo/route.ts:78` updates by `gumroad_product_id` with no `user_id` filter — currently blocked by RLS, but add it as defense-in-depth in case the client is ever swapped for a service client. `review/ai-review/route.ts:32` lets a client-supplied `body.autonomous === true` override the server env gate — drop the body flag.

---

# Suggested order of work

Ordered by (risk removed) ÷ (effort), not by severity alone.

**Today — small diffs, large risk reduction**

1. **C2** — one line: `if (!webhookSecret) return 503`. Closes unauthenticated spend.
2. **H1** — invert 7 cron guards. Same shape, same afternoon.
3. **C1** — gate `act:` on an env flag defaulting off. Restores the Review Gate.
4. **C3** — refuse to submit production when shipping came from the demo fallback.
5. **H2** — glob the test script, fix the mock, un-exclude tests from tsc. **Do this early — it restores your signal on everything else.**

**This week — correctness**

6. **H7(c) + M13** — add the `.ok` checks. Copy the helper from `etsy.ts:223`.
7. **H4** — `after()` + a staleness reclaim on `order_queue`.
8. **H3** — fix the refresh buffer and make the credential write conditional.
9. **H5, H6** — multi-item orders and variant selection. Both are "customer gets the wrong thing" bugs.
10. **H9** — one-line fix, copy the `Math.min` from `createProduct` 400 lines up.
11. **M12** — two indexes + a `.limit()`. Minutes of SQL.

**Then — pricing, properly**

12. **H7(a)** — `setVariantPrices` with absolute catalog targets, plus a creation-time assertion so Forge can't freelance. *Then* run your normalization. Audit live prices first in case the reprice was re-fired.
13. **H8** — fix the margin formula and add the profit guardrail.

**Then — structural**

14. **M14** — delete ~1,600 lines of dead code. Makes everything after this cheaper.
15. **M15** — one `dynamic()` call, −584 KB off the landing route.
16. **M9** — document the 31 env vars.
17. **M11** — de-duplicate `configReady` / `showToast` / cron auth / `requireUser`.
18. **M16** — split `autopilot/service.ts` and `etsy.ts`.
19. **M17** — write the P0 tests against the newly-split units.
20. **M10** — one `system_alerts` table + a Mission Control banner. This is the finding that makes every future finding self-reporting.

---

# What's healthy

Worth stating plainly, because the list above is long and the baseline is genuinely good.

**Type safety** — **zero** `any`, `as any`, or `Record<string, any>` in 322 files (every grep hit was the English word). **Zero** `@ts-expect-error` / `@ts-ignore`. `strict: true`. All ~100 `!` assertions traced to a preceding guard. All LLM structured output flows through `completeJson` → real zod `.parse()` with retry and cross-provider failover — the strongest-engineered part of the codebase.

**The Etsy OAuth flow is solid.** PKCE S256 correct, verifier from `randomBytes(32)`, state stored server-side bound to `user_id`, consumed one-time, 30-minute expiry. Session-fixation is **explicitly defended** at `auth/etsy/callback/route.ts:88` (`dbSession.userId !== user.id` → reject) — a cross-user token-injection attack was attempted against it and blocked. Callback redirects are built from `NEXT_PUBLIC_APP_URL`, not attacker input. `etsy_oauth_sessions` has RLS enabled with zero policies — intentional and correct for service-role-only PKCE verifiers.

**Secrets are clean.** Zero `process.env` in any `"use client"` file. Grepped the built `.next/static/` bundle for `SERVICE_ROLE`, `sk-proj`, `PRINTIFY_API_TOKEN`, `OCTANE_SHARED_SECRET` — zero matches. Only three `NEXT_PUBLIC_*` vars, all safe by design. No token logging anywhere; `etsy-auth.ts:167` surfaces only `error_description`.

**Per-user RLS is correct on 16 tables** — `ajax_tasks`, `product_ideas`, `product_listings`, `review_queue`, `agent_feedback`, `factory_events`, `content_jobs`, `product_generations`, `etsy_credentials`, `order_queue`, `tiktok_queue`, `strategy_recommendations`, `llm_usage_log`, `listing_performance_snapshots`, `market_keywords`, `video_jobs`. Storage: `product_pdfs` is private with four `auth.uid()`-scoped policies.

**No raw SQL anywhere** — `.rpc(`, `` sql` ``, `query(` all return zero real matches.

**The Next 16 migration was done properly.** All 13 dynamic `params`/`searchParams` sites correctly typed `Promise<…>` and awaited. `after()` imported from `next/server` and used correctly in three places. No leftover `unstable_` prefixes. H4 is the single miss.

**React correctness** — no missing `key` props across all 322 files. No `createContext`, so no unmemoized-context-value bugs. Every `setInterval` in a live component has `clearInterval` cleanup. The 515-line `[]`-deps effect in `factory-floor-3d.tsx` is *correct* — build the WebGL scene once, mutate via ref.

**Money units are right.** Etsy reads use `Math.round((amount/divisor)*100)`, writes use decimal-dollar strings; Printify is cents throughout, and every `variantIds` entry has a matching `variantPrices` key across all 5 catalog entries. `charmUp` rounding was verified algebraically and never undershoots.

**The adapter house style is good** — `etsy.ts`, `gumroad.ts`, `lemonsqueezy.ts`, `etsy-auth.ts`, `nova/research.ts`, `pixel/trend-research.ts`, `fal-render.ts` all use the correct `.text()` → parse → check-`.ok` pattern. M13 is the exception, not the rule.

**Order-queue dedupe is race-safe** — the `23505` unique-violation branch at `order-processor.ts:225` handles repeated webhook deliveries correctly. The webhook HMAC itself (`etsy-orders/route.ts:26`) does a length check before `timingSafeEqual`. `assertOrderStatusTransition` correctly enforces the state machine. `sanitizeStylePrompt` blocks a substantial IP-infringement term list before any image generation.

**Autopilot paces its Etsy calls** deliberately — 300ms between audits, 400ms in the heal loop, with documented batch caps. That's real rate-limit hygiene.

**Query discipline** — `mission-control` parallelizes 11 queries with `Promise.all` and caps every one; `dashboard` parallelizes 8; `fetchGenerationsByListingId` correctly batches with `.in()`.

**And the code comments are unusually good** — several document the exact date and symptom of the bug they fixed (*"the 2026-07-22 bandana wave failed vision QA on exactly that"*). That's what made this audit tractable, and it's what will make the sibling-copy pattern easy to hunt: when you fix something, grep for the other call site.

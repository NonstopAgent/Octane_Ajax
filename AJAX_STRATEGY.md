# Ajax Operating Playbook & Strategy Memory

**This file is Ajax's brain-memory.** Every agent (Nova, Forge, Pixel, War Room, Autopilot)
and every human/AI session working on this shop should read this first and follow it. When
anyone changes strategy, update this file **with the reasoning** so future decisions build on
it instead of undoing it.

Last updated: 2026-07-02

---

## 0. Prime directive
Run **GotchaDayGoods** (formerly OctaneAjax) as an automated print-on-demand gift shop on
**Etsy**, fulfilled by **Printify**.
Grow revenue by maximizing every Etsy ranking factor we control and keeping a steady stream of
quality listings live. A human approves new products (Review Gate) until full autonomy is turned on.

Nobody can force Etsy or AI shopping surfaces (ChatGPT / Gemini / Copilot) to "always" pick us —
those surfaces pull from **Etsy's own ranking + listing data**. So the entire game is: **max every
published ranking factor.** There is no magic "be #1" switch.

---

## 0.5 Brand — GotchaDayGoods (locked 2026-07-03)
- **Niche:** pet-gift shop — rescue/adoption gifts first (gotcha day, adoption anniversaries),
  plus pet memorial, senior-dog tributes, dog mom/dad identity gifts. Demand-backed:
  pet memorial 47.3k/mo, dog memorial 35.4k, custom pet portrait 19.2k, dog dad gift 8.5k.
- **Voice:** warm, celebratory, "made for the one they rescued." Never grim or somber — even
  memorial designs read as loving tributes.
- **Palette (matches product art + logo):** cream #FAF3EB, terracotta #C46F4F, blush #F4D8C8,
  sage #A9C3B4, cocoa #4B372B.
- **Assets:** `etsy-assets/gotchadaygoods-logo-500.png`, `etsy-assets/gotchadaygoods-banner-1600x400.png`
  (generator: `etsy-assets/generate_gotchadaygoods_brand.py`).
- **Share & Save link:** `https://gotchadaygoods.etsy.com` (code default + `ETSY_SHARE_SAVE_URL`).
  Old `octaneajax.etsy.com` links die at rename — never publish them again.
- **App/repo name stays Octane Ajax** — that's the internal factory, not the storefront.

---

## 1. Source of truth (avoid the two-systems conflict)
Two systems can overwrite each other. Rules so agents don't fight:

- **Product content** (title, description, tags, attributes, mockups) → **Printify is source of
  truth.** Edit in Printify, sync to Etsy.
- **Pricing** → defined by the **code pipeline bands** in §3. Applied on Etsy. Do NOT push stale
  Printify prices (see warning in §3).
- **Etsy-only levers** (coupons/auto-offers, free-shipping profile, Share & Save link, returns
  policy) → live only on **Etsy**; Printify cannot manage these. Don't expect them to sync.

---

## 2. Etsy ranking factors — what we control
| Factor | Status | How we win it |
|---|---|---|
| Relevance (keywords) | ✅ | 13 proven tags (≤20 chars), keyword-rich 130–140 char titles, full descriptions |
| Shipping | ✅ | **FREE US shipping.** Etsy actively suppresses US listings with >$6 shipping. Shipping is **baked into the retail price.** |
| Listing quality / CTR | ✅ | Correct artwork orientation (portrait art on portrait posters), clean featured image, filled attributes |
| Recency | ⚙️ ongoing | Every new listing gets a temporary ranking boost. **Steady publishing cadence IS an SEO strategy** — keep the factory producing. |
| Returns policy | ⏳ pending | Awaiting owner decision (see §8). Complete policy = ranking + trust. |
| Reviews / sales | 🔁 compounding | Driven by the 4 auto-offers (§4) + Share & Save link. The flywheel. |

---

## 3. Pricing strategy — CANONICAL, do not undo
**Shipping is baked into the retail price and US shipping is FREE.** The buyer pays about the same
total as before, but we get the free-shipping ranking boost and a cleaner sticker price for AI
shopping surfaces.

Bands (shipping included):
- **Mug** — $24.99
- **Poster** — $27.99 (11×14) / $32.99 (12×18) / $39.99 (18×24)
- **Tee** — $29.99
- **Sweatshirt** — $39.99

Nova/Forge already price new products to these bands (deployed by the other agent).

> ⚠️ **Do NOT re-sync old Printify prices.** The old flat $19.99 (and an abandoned interim edit of
> $20.99 / $26.99 / $32.99) would clobber the free-shipping pricing and re-introduce the >$6
> shipping penalty. If Printify prices are ever edited, they must match the bands above **and** the
> Etsy shipping profile must stay free. New Printify listings arrive with paid shipping until the
> store default is set to free in Printify once.

---

## 4. Offers & growth levers (live on Etsy)
Four auto-offers, all 10%, cost nothing unless a sale happens:
- **WELCOME10** — interested shopper
- **COMEBACK10** — abandoned cart
- **THANKYOU10** — post-purchase thank-you
- **FAVE10** — favorited an item

Plus the **Share & Save** link to push the reviews/sales flywheel.

---

## 5. Hard-won lessons (feed these into Autopilot's audit)
Why the shop had ~1 view in 4 days — and what Ajax must never repeat:
1. The listing shipped with **0 tags** → invisible in Etsy search. (Fixed: 13 tags now on
   Printify + Etsy. Root cause: tags weren't flowing app → Printify → Etsy.)
2. **$7.59 shipping** → Etsy ranking penalty. (Fixed: free shipping + baked-in pricing.)
3. **One listing + brand-new shop** → tiny search surface, low ranking for weeks. (Fix: steady cadence.)

**Autopilot audit rules — a live listing is unhealthy if it has any of:**
- fewer than 13 tags, or any tag > 20 chars
- title shorter than ~110 chars (wasting keyword space)
- US shipping over $6 / not free
- empty core attributes (orientation, color, style, occasion, room)
- price outside its band (§3)
→ auto-fix the small ones; queue anything bigger.

---

## 6. Personalization
Skipped for fixed-design posters — it would force manual artwork edits per order and break the
hands-off flow. Revisit later as a separate made-to-order product line if we want the ~20% upcharge.

---

## 7. Autonomy roadmap
- **Now:** Autopilot "auto-fix small, queue big" — auto-applies low-risk fixes to EXISTING live
  listings (tags, title, attributes, pricing-in-band) and auto-schedules marketing. Brand-new
  products still wait for one-click approval at the Review Gate.
- **Soon (owner wants this "very soon"):** full autonomy — Autopilot also publishes new products
  without manual review once trust is established.
- **Cadence:** as continuous as Vercel allows. Target every ~6h, plus event-driven runs when a
  shopper interacts, plus "run whenever Ajax judges there's something worth doing."
- **Future modules to fold under Ajax's control:** a Polymarket trader, affiliate-link management,
  and more the owner keeps adding. Ajax should be architected so new "operators" plug into the same
  monitor → decide → act → report loop.

---

## 8. Open decisions (need the owner)
- **Returns policy: choose 1 or 2.** Practical reality: a returned poster "ships back" in theory,
  but in practice you just refund and let them keep it. Autopilot queues a recommendation until decided.
- ~~Approve the senior-dog mug~~ ✅ approved + published 2026-07-03. Listing-level price/shipping
  polish assigned to Agent 2 (`AGENT2_BRIEF.md`).

---

## 9. Change log
- **2026-07-02 — other agent:** Free US shipping enabled; prices restructured to baked-in bands
  ($27.99/$32.99/$39.99 poster, mug $24.99, tee $29.99, sweatshirt $39.99); 4 auto-offers live;
  attributes filled (materials/width/height); pipeline repriced so all future products bake shipping
  in; pending senior-dog mug repriced. Tests 263/263, build clean, production Ready.
- **2026-07-02 — this agent:** Set Printify as content source of truth; loaded optimized title
  (130/140), full description, and 13 tags + Beige primary color into the Printify product; abandoned
  an interim Printify price edit in favor of the free-shipping bands above; wrote this playbook.

---

## 10. Next code step — ✅ SHIPPED 2026-07-03
`runShopAutopilot` is live: hourly-capable audit → auto-fix (tags, free shipping) → queue
(pricing/returns recommendations) → react (Pixel marketing for stalled listings) → produce
(new cycle when the gate is clear and listings < target 15). Routes: `/api/cron/shop-autopilot`
(daily Vercel cron 07:30 UTC — Hobby limit) + `.github/workflows/shop-autopilot-hourly.yml`
(hourly once the `CRON_SECRET` repo secret is added — Agent 2 task).

## 11. Change log (recent)
- **2026-07-03:** Shop Autopilot shipped + first live pass clean. Product-art quality fix:
  apparel/mugs now generate ISOLATED transparent-background designs (no more art-with-background
  pasted as a box on shirts); per-product composition rules; posters stay full-bleed. Overnight
  batch pre-fix: 4 apparel products rejected by owner + 1 pending rejected by agent (same flaw);
  the published "Adopted and Loved Dog Mom T-Shirt" should stay DEACTIVATED until regenerated.
  Rebrand locked: **GotchaDayGoods** (see §0.5); new logo/banner generated; share-link default +
  Pixel hashtag updated in code.

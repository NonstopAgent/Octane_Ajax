# Etsy Listing Quality Standard — Gotcha Day Goods

Grounded in Etsy's official search guidance (Aug 2025): *The Ultimate Guide to Etsy Search*, *Keywords 101*, and *Add Attributes to Increase Your Shop's Visibility*. Every listing the factory produces should meet this **before it reaches the Review Gate**.

## How Etsy search actually works (two phases)

1. **Query matching** — Etsy first gathers *every* listing whose keywords match the shopper's search. Keywords live in the **title, tags, categories, attributes, and description** — all five count, and they work together.
2. **Ranking** — among the matches, Etsy ranks by listing quality / conversion rate, recency (new listings get a temporary boost), shipping price (free or ≤ $6 is favored), and customer-service signals (reviews, policies).

**Takeaway:** you can't rank for a search you don't *match*, and matching means spreading keywords across all five fields. More well-optimized listings = more surface area = the real growth lever. Two listings will stay low no matter how polished; volume is the unlock.

## The standard (apply to every listing)

1. **Category** — pick the *most specific* subcategory. Categories act like tags. (Mug → Mugs ✓ · Poster → Art & Collectibles › Prints ✓)
2. **Title** — lead with the plain phrase for what the item *is*; keep it human-readable; use `|` to separate 3–6 real phrases. Etsy: *position in the title does not affect ranking* — so front-load for the shopper, not the algorithm. Don't keyword-stuff.
3. **Tags** — use all **13**. Multi-word long-tail phrases (≤ 20 chars each), every tag unique, no repeats of category/attribute words, no misspellings, one language. Diversify across: descriptive · material/technique · who-it's-for · occasion · solution · style · size.
4. **Description** — put real keywords in the **first 1–2 sentences** (this is what the ranking algorithm and the AI-shopping surfaces read first). Sound human; don't copy the title verbatim.
5. **Attributes** — fill **every relevant one**. Each attribute acts like a tag *and* powers Etsy's sidebar filters — **the only way to appear in a filtered search is to have that attribute set.** Describe what the item *is*, not how it's used (e.g. don't add a Holiday attribute to a product that isn't holiday-specific).
6. **Photos** — up to 20. A clean primary photo that shows the design clearly (it's the search thumbnail), then angles + lifestyle shots.
7. **Video** — real product **in context** (mug on a counter, art framed on a wall), square aspect, any on-screen text kept inside safe margins. Reference build: `etsy-assets/generate_listing_videos_v2.py`. Do **not** ship flat-art zoom clips.
8. **Shipping** — free US shipping baked into price (Etsy actively suppresses listings that ship for more than $6).
9. **Conversion over time** — reviews, a returns policy, and fast processing all feed ranking.

## Current audit (as of this session)

**Senior Dog Tribute Mug** — Category ✓ · Title front-loaded but only 56/140 chars (room for 2–3 more phrases) · Description ✓ (drop the "AI tools assisted…" line) · Tags 13 ✓ · **Attributes: incomplete** · Video ✓ **rebuilt** · Free shipping ✓

**Adopted & Loved Poster** — Category ✓ · Title keyword-rich ✓ · Description ✓ · Tags 13 ✓ (incl. "animal wall art") · **Attributes: partial** · Video ✓ **rebuilt** · Free shipping ✓

## Ready-to-apply fixes for the two live listings

**Mug title** — add long-tail phrases, e.g.: `Senior Dog Tribute Mug | Dog Memorial Gift | Pet Loss Coffee Cup | Dog Lover Gift | Cherished Companion Ceramic Mug`

**Mug attributes** (category = Mugs — verified: this category has **no color attribute**): Capacity = **11 fl oz** · Graphic/Theme = **Animal** · Materials = **Ceramic**. Leave Holiday & Occasion **empty** (a tribute mug isn't holiday/occasion-specific — per Etsy's "describe what it is" rule).

**Poster attributes** (category = Prints): Orientation = **Vertical** · Primary color = **Beige** · Secondary color = **Green** · Subject/Graphic = **Animal (Dog)** · Room = **Living room** · Frame = **Unframed**.

> **Set attributes via the Etsy API, not the web editor.** The Shop Manager listing editor reproducibly freezes on the attribute section (Etsy renders the entire Materials option list — hundreds of entries — into the DOM), and its searchable dropdowns don't respond reliably to automation. The pipeline already talks to the Etsy API to create listings, so it should set attributes with `updateListingProperty` at creation time. Editing them by hand in the browser is slow and risky (a mis-targeted field can change the price).

## What the autonomous pipeline must enforce

Before any product hits the Review Gate, the factory should auto-populate: a specific category, 13 diverse long-tail tags, a keyword-first description, **all** relevant attributes, a free-shipping-inclusive price, and a real-mockup video. That makes every new listing search-ready on arrival — which, combined with steady volume, is what actually grows traffic.

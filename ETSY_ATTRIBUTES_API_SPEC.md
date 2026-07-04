# Spec: Set Etsy Listing Attributes via API (pipeline)

**Why:** Etsy's Shop Manager listing editor cannot be automated for attributes — it freezes rendering the full Materials option list (hundreds of entries), and its searchable dropdowns don't respond to scripting. Attributes must be set via the **Etsy Open API v3** after a listing exists. This is high-value: attributes power Etsy's sidebar filters (the *only* way a listing shows up in a filtered search) and strengthen keyword matching.

## Endpoints (Etsy Open API v3)

**1. Discover valid properties + values for the listing's category**
`GET /v3/application/seller-taxonomy/nodes/{taxonomy_id}/properties`
Header: `x-api-key: {keystring}:{shared_secret}` — the same header the app already builds in `etsy-auth.ts`.
Returns `results[]`, each with: `property_id`, `property_name` (e.g. "Graphic", "Room", "Orientation", "Occasion", "Holiday", "Capacity", "Craft type", "Primary color"), `scales[]` (`scale_id`, `scale_name`, e.g. "Fluid ounces"), and `possible_values[]` (`value_id`, `name`, e.g. `{value_id, name:"Animal"}`).

> Property IDs and value IDs vary by taxonomy and change over time. **Always resolve them at runtime from this endpoint — never hardcode IDs.**

**2. Set one property on the listing**
`PUT /v3/application/shops/{shop_id}/listings/{listing_id}/properties/{property_id}`
Auth: `Authorization: Bearer {oauth_token}` (needs `listings_w` scope — already granted) **plus** the `x-api-key` header.
`Content-Type: application/x-www-form-urlencoded`
Body:
- Fixed-list attribute → `value_ids=<id>` **and** `values=<name>` (e.g. Graphic → the value_id whose name is "Animal").
- Scaled numeric (Capacity, Dimensions) → `scale_id=<id>` + `values=11`.
One PUT per property.

## Where it hooks into the code

Publish path is `src/lib/review/printify-publish-on-approve.ts` → `publishListingViaPrintify()`. After `adapter.publishProduct()` succeeds, `externalId` (currently stored as `gumroad_product_id`) is the Etsy listing id — Printify's `product.external.id`.

1. Add to the Etsy adapter (`src/lib/ajax/adapters/etsy.ts`):
   - `getTaxonomyProperties(taxonomyId): Promise<EtsyProperty[]>`
   - `setListingProperty(listingId, propertyId, { valueIds?, values?, scaleId? }): Promise<void>`
   - `applyAttributes(listingId, taxonomyId, desired): Promise<{ set: string[]; skipped: string[] }>` — fetches the taxonomy properties, matches each `desired` key to a `property_name` (case-insensitive), matches each desired value to a `possible_values` entry (or uses `scale_id` + raw value for scaled props), PUTs each, and **skips any property the taxonomy doesn't offer**.
2. In `publishListingViaPrintify`, once the Etsy `listing_id` is known, call `applyAttributes(etsyListingId, taxonomyId, desiredForProductType)`, then log a factory event with `{set, skipped}`. **Never throw** — match the existing fail-soft pattern in that file.

**Timing caveat:** Printify creates the Etsy listing asynchronously, so `product.external.id` may be empty in the immediate publish response. Get the Etsy `listing_id` by re-reading the Printify product's `external` field a few seconds after publish (short poll) or from Printify's `publishing_succeeded` webhook, then apply attributes.

## Desired attributes per product type

Resolve names against the taxonomy at runtime; skip anything the category doesn't expose.

- **Mug** (Mugs category — *verified: no color attribute exists here*):
  `Graphic = "Animal"`, `Craft type`/`Material = "Ceramic"`, `Capacity = 11` (scale: Fluid ounces).
- **Poster / Art print** (Prints category):
  `Orientation = "Vertical"`, `Primary color = "Beige"`, `Secondary color = "Green"`, `Subject`/`Graphic = "Animal"`, `Room = "Living room"`, `Frame = "Unframed"`.
- **Rule (Etsy's own):** only set attributes that describe what the item *is*. Never set Occasion or Holiday on a product that isn't occasion/holiday-specific (both current products included).

## Backfill the two existing listings

Add a one-off admin route or script that runs `applyAttributes` for:
- **Mug** — Etsy listing_id `4531808003`, taxonomy = Mugs
- **Poster** — Etsy listing_id `4529408131`, taxonomy = Prints

Both Etsy listing_ids are stored in `product_listings.gumroad_product_id`.

## Verify

After a cycle, `GET .../listings/{id}/properties` (or check the live listing's filters on Etsy) to confirm attributes applied. Confirm the exact request encoding against current docs: developers.etsy.com/documentation/reference → `getPropertiesByTaxonomyId` and `updateListingProperty`.

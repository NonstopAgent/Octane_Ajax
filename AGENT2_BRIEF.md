# Agent 2 Brief — Listing Polish + External Accounts (Etsy/Printify/GitHub)

You are the second Cowork agent on Octane Ajax (Etsy shop, being renamed to
**GotchaDayGoods**). Agent 1 owns the codebase, the app deploy, and the
shop-level rebrand (name, icon, banner, announcement/story). **Your lane is
listing-level polish and external account settings.** Do not edit code, do not
rename the shop, do not touch the shop icon/banner/announcement.

Read `AJAX_STRATEGY.md` first — it is the shared playbook (free-US-shipping
pricing model, pet-gift niche, quality rules).

## Context you need
- Live Etsy listings: "Adopted & Loved Rescue Dog Poster" and two just-published
  items: "Forever My Best Friend - Senior Dog Tribute Mug" and "Adopted and
  Loved Dog Mom T-Shirt".
- Etsy search visibility page shows 2 warnings: title recommendations + listings
  with only 1 photo.
- Printify is the product source of truth. The Printify browser session was
  logged out — the operator must log in once for you.

## Tasks (in priority order)

### 1. Deactivate the bad tee (Etsy)
"Adopted and Loved Dog Mom T-Shirt" prints the poster art as a solid square on
the shirt — it looks pasted-on. Etsy → Listings → Deactivate (NOT delete).
Agent 1's pipeline fix will regenerate apparel art properly; it can be
reactivated with new art later.

### 2. Add photos to the live listings (Etsy/Printify)
Both remaining listings need 5+ photos (Etsy ranking factor).
In Printify → product → Edit → mockup gallery: select ~8 varied mockups
(front, angle, lifestyle, size chart) → save/publish so they sync to Etsy.
Verify on Etsy that the listing then shows multiple photos and pick the
cleanest thumbnail (Etsy listing editor → Adjust thumbnail).

### 3. Mug listing fixes (Etsy)
"Forever My Best Friend" mug: set price to **$24.99** (free-shipping-baked
floor) and move it to the **free-US-shipping profile** (Listing editor →
Pricing & Shipping → shipping profile dropdown → the "Standard: Sensaria …"
profile that now ships free US, or any free profile). The autopilot fixes the
shipping automatically within a day, but manual is faster.

### 4. Etsy title recommendations
Shop Manager → Etsy search visibility → "Update titles": review each suggested
title. Apply only when the suggestion keeps the top keywords (gotcha day /
rescue dog / dog mom / senior dog). Do not accept suggestions that strip
keywords.

### 5. Printify store settings (operator must log in)
- Store settings → Shipping: set **Free shipping (US)** so every future
  published listing inherits free shipping.
- Disable **Automatic optimization** (it can overwrite our optimized
  titles/tags on Etsy).
- Mirror prices on the poster product: 11×14 $27.99 / 12×18 $32.99 /
  18×24 $39.99; mug $24.99 (Printify is source of truth — prevents re-sync
  from reverting Etsy edits).

### 6. GitHub Actions secret (unlocks hourly autopilot)
Repo `NonstopAgent/Octane_Ajax` → Settings → Secrets and variables → Actions →
New repository secret: name `CRON_SECRET`, value = the CRON_SECRET from the
Vercel project env (Vercel → octane-ajax → Settings → Environment Variables).
This activates `.github/workflows/shop-autopilot-hourly.yml` (hourly shop
audits instead of daily).

### 7. After Agent 1 renames the shop → verify Share & Save
Shop Manager → Marketing → Share & Save: confirm the trackable link now reads
`gotchadaygoods.etsy.com`. Report the exact link back to the operator.

## Coordination rules
- Log what you change (listing + field) back to the operator in chat.
- If Etsy/Printify show a conflict warning about pending sync, stop and report.
- Never publish new products; never delete anything; deactivate only item #1.

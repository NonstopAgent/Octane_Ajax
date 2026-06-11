# Octane Ajax — Agent Instructions

Guidance for coding agents working in this repository.

---

## 1. Project Identity

**Octane Ajax is NOT an Etsy bot.**

It is a private solo-operator **business engine** for niche print-on-demand (POD) physical products. Etsy is **Business Unit #1** — one channel, not the whole vision. Agents should design and implement features that support a broader product and revenue system, not a single marketplace automation script.

**Octane Ajax does NOT sell digital downloads, printables, planners, or PDFs.** That strategy is retired. Do not propose, generate, or reintroduce PDF/printable products or pipelines.

---

## 2. Core Business Rule

**Quality over volume.** Octane Ajax prioritizes high-quality, niche, emotionally resonant, and compliant POD products over bulk AI-generated spam. When suggesting product ideas, copy, or automation, favor specificity, original artwork direction, and real giftability for a defined audience.

---

## 3. Human Review Gate

The **Review Gate is mandatory.**

- Do **not** remove, weaken, or bypass the Review Gate.
- **No live publishing** without human review.
- Etsy/Printify integration must create **draft listings only** until a human explicitly approves publication.

Treat any change that skips or shortcuts review as out of scope unless the user explicitly requests a documented exception.

---

## 4. Product Strategy

Target **niche print-on-demand physical gifts** with original AI-assisted artwork (generated via OpenAI `gpt-image-1`), fulfilled by Printify:

- Mugs, posters, art prints, t-shirts, sweatshirts, tote bags, phone cases

Use this formula when evaluating or generating product concepts:

> **Specific person / identity** + **specific passion, profession, pet, milestone, or inside-joke** + **concrete POD format** + **original IP-safe design direction**

Products should make a clearly defined buyer say "this was made for me" (or "this is the perfect gift for ___") — not generic "funny mug" filler.

---

## 5. Blocked Product Rules

Agents must **avoid** creating, suggesting, or shipping content that includes:

| Category | Examples to avoid |
|----------|-------------------|
| Digital downloads | PDFs, printables, planners, templates — retired product line |
| Medical | Diagnosis, treatment, or cure claims |
| Legal | Legal advice or "you should sue / file" guidance |
| Financial | Investment, tax, or trading advice |
| IP / brands | Copyrighted brands, characters, celebrities, schools, sports teams, franchises |
| Misleading claims | Guaranteed results, "official" outcomes, or unverifiable promises |
| Impersonation | Official government forms, bank documents, or institutional letterhead presented as real |

When in doubt, choose a generic, compliant alternative and flag ambiguity for human review.

---

## 6. Technical Standards

| Area | Requirement |
|------|-------------|
| Framework | Next.js **App Router** |
| Language | **TypeScript** |
| Styling | **Tailwind CSS** |
| Backend | **Supabase** — Auth, Postgres, **RLS**, Realtime |
| Images | **OpenAI `gpt-image-1`** for product artwork; Printify for fulfillment |
| Secrets | Server-only; never expose service role or other privileged keys to the client |
| Security | **Keep RLS enabled**; do not disable policies to "make it work" |
| Testing | Use tests for **business rules** and critical paths |
| Verification | After major changes, run: `npm run lint`, `npm run test`, `npm run build` |

### Next.js version note

<!-- BEGIN:nextjs-agent-rules -->

**This is NOT the Next.js you know.** This project may use a Next.js version with breaking changes — APIs, conventions, and file structure can differ from your training data. Before writing or refactoring Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

<!-- END:nextjs-agent-rules -->

---

## 7. Cursor Workflow

- **Do not multitask** core state-machine refactors (e.g. product lifecycle, review gate, revenue rules). Work those on a single focused thread.
- **Multitask only** independent lanes (e.g. unrelated UI polish vs. a isolated utility module).
- **Reconcile** all parallel changes before a final `npm run build`.
- **Summarize** for the user: files changed, tests run, and remaining risks or follow-ups.

---

## 8. Current Phase

**POD pivot.** The pipeline is: Nova (niche gift ideation, grounded in live Etsy market data) → Product Brain (scoring + compliance) → Forge (listing draft + Printify blueprint + artwork prompt) → gpt-image-1 artwork → Printify draft product → **Human Review Gate** → publish. Legacy PDF/printable code is retired; do not extend it.

---

## Quick checklist for agents

- [ ] Changes respect the Human Review Gate
- [ ] Product ideas are physical POD gifts that fit the niche-identity strategy and blocked-product rules
- [ ] No digital-download / PDF / printable product logic reintroduced
- [ ] RLS and server-only secrets unchanged or strengthened
- [ ] `npm run lint`, `npm run test`, `npm run build` pass after substantive edits

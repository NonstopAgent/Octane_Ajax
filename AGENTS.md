# Octane Ajax — Agent Instructions

Guidance for coding agents working in this repository.

---

## 1. Project Identity

**Octane Ajax is NOT an Etsy bot.**

It is a private solo-operator **business engine** for utility-first digital downloads. Etsy is **Business Unit #1** — one channel, not the whole vision. Agents should design and implement features that support a broader product and revenue system, not a single marketplace automation script.

---

## 2. Core Business Rule

**Quality over volume.** Octane Ajax prioritizes high-quality, useful, niche, and compliant products over bulk AI-generated spam. When suggesting product ideas, copy, or automation, favor depth, clarity, and real utility for a specific audience.

---

## 3. Human Review Gate

The **Review Gate is mandatory.**

- Do **not** remove, weaken, or bypass the Review Gate.
- **No live publishing** without human review.
- Future Etsy integration must create **draft listings only** until a human explicitly approves publication.

Treat any change that skips or shortcuts review as out of scope unless the user explicitly requests a documented exception.

---

## 4. Product Strategy

Target **utility-first digital products**, including:

- Planners, trackers, worksheets, checklists, templates, logbooks, bundles

Use this formula when evaluating or generating product concepts:

> **Specific person** + **specific problem** + **structured printable format** + **clear usefulness**

Products should solve a narrow, real problem for a defined audience — not generic “inspiration” or filler content.

---

## 5. Blocked Product Rules

Agents must **avoid** creating, suggesting, or shipping content that includes:

| Category | Examples to avoid |
|----------|-------------------|
| Medical | Diagnosis, treatment, or cure claims |
| Legal | Legal advice or “you should sue / file” guidance |
| Financial | Investment, tax, or trading advice |
| IP / brands | Copyrighted brands, characters, celebrities, schools, sports teams, franchises |
| Misleading claims | Guaranteed results, “official” outcomes, or unverifiable promises |
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
| Secrets | Server-only; never expose service role or other privileged keys to the client |
| Security | **Keep RLS enabled**; do not disable policies to “make it work” |
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

**Phase 2** starts with **Product Brain** and **Revenue Rules** before adding real LLM calls. Prefer deterministic rules, schemas, and testable logic over wiring production LLM endpoints until that foundation is stable.

---

## Quick checklist for agents

- [ ] Changes respect the Human Review Gate
- [ ] Product ideas fit utility-first strategy and blocked-product rules
- [ ] RLS and server-only secrets unchanged or strengthened
- [ ] `npm run lint`, `npm run test`, `npm run build` pass after substantive edits

---

## Cursor Cloud specific instructions

### Environment

- **Runtime:** Node.js 22+ with npm (lockfile: `package-lock.json`).
- **Secrets** are injected as environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.
- Create `.env.local` from these env vars before running the app (Next.js reads `.env.local` at startup).
- The Supabase cloud project is pre-provisioned with all migrations applied.

| Variable | Scope | Required | Purpose |
|----------|-------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Yes | Anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Yes | PDF storage/download routes, admin user creation |
| `OPENAI_API_KEY` | Server only | No | Nova/Forge LLM mode; omit for deterministic fallback |

### Verification before committing

Agents **must** run all four checks before committing:

```bash
npm run check:demo   # Live Supabase schema + optional auth probe
npm run lint         # ESLint (warnings only for unused adapter stubs)
npm run test         # 155+ tests via node --test + tsx (after async PDF split)
npm run build        # Production build (TypeScript + static generation)
```

`npm run dev` starts the dev server on `localhost:3000`.

### Production-safe pipeline (staged requests)

The pipeline is intentionally split into separate HTTP requests to avoid Vercel serverless timeouts. **Do not collapse these stages into a single long request.**

| Step | Where | Action | Endpoint |
|------|-------|--------|----------|
| 1 | `/factory` | Run Ajax Cycle (Nova → Forge → pause) | `POST /api/ajax/run-cycle` |
| 2 | `/review` | Generate PDF for listing | `POST /api/ajax/product-generations/[id]/generate-pdf` |
| 3 | `/review` | Download PDF for inspection | `GET /api/ajax/product-generations/[id]/pdf-download` |
| 4 | `/review` | Approve (or reject with feedback) | `POST /api/ajax/review/approve` |
| 5 | `/factory` | Run Pixel → demo publish | `POST /api/ajax/run-pixel` |
| 6 | `/store` | Published listing visible | — |

**Critical constraint:** `POST /api/ajax/run-cycle` must **not** perform PDF generation synchronously. PDF generation is a separate request from the Review Gate (`POST /api/ajax/product-generations/[id]/generate-pdf`). The Review Gate remains mandatory between Forge output and Pixel/publish.

### Key gotchas

- **No sync PDF in run-cycle:** Combining Nova + Forge + PDF in one serverless invocation causes Vercel timeouts. Keep them as separate staged requests (see pipeline table above).
- **Cookie auth for API testing:** The `@supabase/ssr` v0.10 library stores sessions in chunked cookies named `sb-<project-ref>-auth-token.0`. To call API routes from scripts (curl/Python), sign in via Supabase Auth REST, then set the cookie as raw JSON (not base64) in the `Cookie` header.
- **Run-cycle duration:** `POST /api/ajax/run-cycle` calls OpenAI (Nova + Forge, no PDF) and can take 30–80 seconds when `OPENAI_API_KEY` is set. Without it, falls back to instant deterministic demo mode.
- **Approve needs reviewId:** `POST /api/ajax/review/approve` requires `{ "reviewId": "<uuid>" }` in the body. Get pending reviews from `GET /api/ajax/review-queue`.
- **Next.js middleware deprecation warning** (`"middleware" file convention is deprecated`) is expected on Next.js 16.2.6 — does not affect functionality.
- **Test user creation:** Use the Supabase Admin API (`POST /auth/v1/admin/users` with service role key) to create confirmed users for testing without needing email verification.

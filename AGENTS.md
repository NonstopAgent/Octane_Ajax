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

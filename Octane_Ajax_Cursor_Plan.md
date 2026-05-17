# Octane Ajax: Phase 2 Strategic Plan & Technical Outline

## The Broader Vision
Octane is not an "Etsy bot." It is a private business operating system that uses agents to create, test, and operate small cash-flow experiments. 

- **Octane Core:** Command center, finance, memory, decisions, tasks.
- **Octane Ajax:** Digital product factory (Business Unit #1).
- **Octane Nexus:** Future creator/content engine.
- **Phase 4 Expansion:** Autonomous trading modules (e.g., Polymarket) funded by initial profits.

## Phase 2 Executive Summary
The immediate goal is to replace the simulated agents in the current codebase with real LLM integrations, targeting hyper-niche, utility-first digital products on Etsy.

**Core Rule:** Do not build "more autonomy" first. Build "better judgment" first. The Review Gate is the most important part of the business, not a temporary limitation. We prioritize high-quality, problem-solving products over bulk-uploading AI spam.

## Market Research & Strategic Direction

### 1. The Product Strategy: "Utility-First" Digital Downloads
Market research indicates that generic AI art and broad planners (e.g., "Daily Planner") are completely saturated. The winning formula in 2026 is **"Broad topic + Specific person + Specific problem + Structured format."** [1]

Octane Ajax will focus exclusively on generating **Utility-First Printables**. These are problem-solving documents like:
- Neuro-diverse educational planners (e.g., "Visual Routine Planners for PDA children")
- Specific chronic condition trackers (e.g., "Hashimoto's food-mood tracker")
- Niche professional logbooks (e.g., "Freelancer client onboarding kit")

**Why this works:**
- These products command higher prices ($15-$29 vs $5 for aesthetic prints).
- Conversion rates are up to 4.4x higher because they solve urgent problems. [2]
- Zero Cost of Goods Sold (COGS), infinite inventory, and no shipping logistics.

### 2. The Platform Strategy: Etsy First
Octane Ajax will launch on **Etsy** as its primary sales channel.

**Why Etsy?**
- **Built-in Traffic:** You do not need to drive your own traffic initially; Etsy brings buyers with high purchase intent.
- **Economics:** The fee structure (~14-18% total take on a $5-$10 product) is manageable given the zero fulfillment cost. [3]
- **API Support:** Etsy Open API v3 fully supports programmatic creation of "draft" listings, which perfectly aligns with the Octane Ajax "Review Gate" architecture. [4]

### 3. Cost & Budget Analysis
The user has allocated a $200-$300 budget to reach profitability. This is highly feasible using modern LLM APIs.

| Expense Category | Estimated Cost | Notes |
| :--- | :--- | :--- |
| **LLM Text Generation** | ~$0.002 per product | Using GPT-4o-mini ($0.15/1M input, $0.60/1M output). [5] |
| **LLM Image Generation** | ~$0.04 - $0.12 per image | Using DALL-E 3 or GPT Image Mini for cover art. [6] |
| **Etsy Listing Fees** | $0.20 per listing | $20 covers the first 100 products. |
| **Total Cost Per Product** | **~$0.15 - $0.25** | Includes research, copy, cover image, and listing fee. |

---

## Technical Implementation Plan for Cursor

This section provides the exact technical steps required to transition the Octane Ajax codebase. **Do not execute this all at once.** Use the Cursor multitask strategy outlined below.

### Step 0: Product Brain + Revenue Rules (Build Judgment First)
Before giving agents LLM power, build the rules that stop Ajax from making garbage.

1. **Create a domain module:**
   - `src/lib/ajax/product-brain/types.ts`
   - `src/lib/ajax/product-brain/rules.ts`
   - `src/lib/ajax/product-brain/scoring.ts`
   - `src/lib/ajax/product-brain/validators.ts`
   - `src/lib/ajax/product-brain/index.ts`
2. **Define product strategy types:**
   - `ProductFormat` = "planner" | "tracker" | "worksheet" | "checklist" | "template" | "logbook" | "bundle"
   - `ProductRiskLevel` = "safe" | "caution" | "blocked"
   - `ProductBrainScore` with urgency, specificity, buyerClarity, usefulness, competitionRisk, complianceRisk, totalScore
   - `ProductBrainVerdict` = "approve_for_generation" | "needs_revision" | "blocked"
3. **Add allowed product categories:**
   - education, productivity, small_business, home_organization, wellness_tracking, parenting_support, student_tools, creator_tools
4. **Add blocked categories/rules:**
   - medical diagnosis/treatment claims, legal advice, financial advice, copyrighted characters/brands, guaranteed results, official form impersonation
5. **Add deterministic scoring:**
   - Score higher for: specific buyer, specific pain/problem, concrete format, obvious usefulness, no banned claims.

### Step 1: LLM Integration Foundation
1. **Environment Setup:** Add `OPENAI_API_KEY` to `.env.local`.
2. **Create the LLM Service Layer:**
   - Create `src/lib/llm/openai.ts`.
   - Implement wrapper function `generateCompletion(prompt, systemInstruction)` handling API calls, retries, and error logging.
   - Ensure support for structured JSON output (`response_format: { type: "json_object" }`).

### Step 2: Empowering the Nova Agent (Research & Ideation)
1. **Update `nova-simulator.ts`:**
   - Inject the existing `buildAgentPromptMemory` context into a prompt.
   - **Prompt Engineering:** Instruct LLM to act as a market researcher outputting JSON: `niche`, `problem`, `productConcept`, `suggestedPrice`.
   - Pass the output through the **Product Brain (Step 0)** before saving to DB.

### Step 3: Empowering the Forge Agent (Creation & Listing Data)
1. **Update `forge-simulator.ts`:**
   - Pass Nova's JSON output into Forge's prompt.
   - **Prompt Engineering:** Instruct LLM to output JSON: `listingTitle`, `listingDescription` (including AI disclosure [7]), `tags`, `productStructure` (array of page descriptions).

### Step 4: Empowering the Pixel Agent (Marketing & Visuals)
1. **Update `pixel-simulator.ts`:**
   - Pass Forge's output into Pixel's prompt.
   - **Prompt Engineering:** Instruct LLM to output `imagePrompt` for DALL-E 3 and `pinterestPinDescription`.

### Step 5: Product Generation Engine (PDF Creation)
1. **Implement PDF Generation:**
   - Install a PDF library like `pdf-lib` or `jspdf`.
   - Create `src/lib/product/pdf-generator.ts`.
   - Programmatically generate a clean, functional PDF based on Forge's `productStructure`.

### Step 6: The Etsy API Integration (The Final Mile)
1. **Implement Etsy Service:**
   - Create `src/lib/etsy/etsy-api.ts`.
   - Implement `createDraftListing` and `uploadListingFile` endpoints.
   - **Crucial Architecture Note:** Always push listings as `draft`. This ensures the human operator makes the final quality/compliance check on Etsy before paying the $0.20 fee.

---

## Phase 4 Expansion: Polymarket Trading Module (Parked)
*This module is parked until the Etsy commerce engine is profitable. It adds financial risk and compliance complexity that should not be tackled in Phase 2.*

When ready, the exact same agent architecture (Nova → Forge → Review Gate → Execute) will be repurposed:
- **Nova:** Scans Polymarket API for mispriced markets.
- **Forge:** Analyzes news sentiment and calculates probability edge.
- **Review Gate:** Human approves trade thesis and sizing.
- **Execute:** Places limit order via CLOB API.
- **Risk Controls:** Max 2% bankroll per trade, daily loss limits, and a kill switch must be hardcoded. [8] [9]

---

## Next Steps for the User (How to prompt Cursor)

### Task 1: Add AGENTS.md
Create an `AGENTS.md` file in the root of the repo with project-specific instructions (e.g., "Octane Ajax is a private business engine for utility-first digital downloads. We prioritize human Review Gates over full autonomy. Always run lint/test/build after major changes.")

### Task 2: Build Step 0
Paste the "First Cursor prompt I'd use now" from ChatGPT to build the Product Brain and Revenue Rules. Do not use multitask for this.

### Task 3: Execute Multitask Strategy
After Step 0 passes, use Cursor multitask for independent lanes. Paste this prompt:

```text
Use multitask mode with separate agents. Each agent must work in its own area and avoid editing files owned by another task unless necessary. After all agents finish, reconcile changes, run lint/test/build, and summarize conflicts.

Agent A — LLM Foundation:
Create src/lib/llm with an OpenAI server-only wrapper, structured JSON helper, retry handling, Zod validation support, cost logging stubs, and environment checks. Do not wire it into Nova/Forge/Pixel yet.

Agent B — Product Data Model:
Inspect current Supabase schema and propose a migration for storing generated product structure, LLM metadata, quality scores, PDF asset URLs, and compliance flags. Do not apply destructive changes. Add TypeScript types/mappers.

Agent C — PDF Generation Prototype:
Create a server-only PDF generator module that accepts structured product pages and outputs a clean downloadable PDF buffer. Use a simple test product. Do not connect it to the main pipeline yet.

Agent D — Review Gate Upgrade:
Improve the /review UI so it can eventually show product brain scores, compliance warnings, page structure preview, and PDF preview/download placeholders. Use mock data if needed. Do not change approve/reject logic yet.

Agent E — Tests & Safety:
Add tests for the new modules, ensure no server secrets are imported into client components, and update README with Phase 2 architecture notes.

After all tasks:
- reconcile imports/types
- run npm run lint
- run npm run test
- run npm run build
- report exactly what changed
```

### Task 4: Core Run-Cycle Refactor
Only after A-E are complete, sequentially wire the LLM outputs into Nova, Forge, and Pixel. Do not multitask this step.

---

### References
[1] Reddit Analysis of 200+ Niches. https://www.reddit.com/r/passive_income/comments/1s8swe4/
[2] 2026 Etsy Printables Case Study. https://howtomakemoneywith.ai/blog/from-0-to-1000month-in-116-days-the-2026-etsy-printables-case-study
[3] Etsy Fee Structure Guide. https://nifty.ai/post/how-much-does-etsy-take-per-sale
[4] Etsy Open API v3 Documentation. https://developer.etsy.com/documentation/tutorials/listings
[5] OpenAI API Pricing. https://openai.com/api/pricing/
[6] AI Image Pricing Comparison. https://costgoat.com/pricing/openai-images
[7] Etsy AI Content Policies 2026. https://ecombalance.com/ai-content-policies-2026/
[8] Polymarket AI Bot Review. https://www.reddit.com/r/PillarLab/comments/1slttbc/
[9] Polymarket API Documentation. https://docs.polymarket.com/api-reference/introduction

import { PRODUCT_FORMATS } from "@/lib/ajax/product-brain/rules";
import { AI_DISCLOSURE_TEXT, FORGE_PROMPT_VERSION } from "@/lib/ajax/forge/types";

export { FORGE_PROMPT_VERSION };

const BLOCKED_GUIDANCE = `
NEVER include content that involves:
- Medical diagnosis, treatment, cures, or clinical claims
- Legal advice or litigation strategy
- Financial, investment, tax, or trading advice
- Copyrighted IP: characters, brands, celebrities, schools, sports teams, franchises
- Guaranteed results or unverifiable outcome promises
- Official government forms, bank documents, or institutional letterhead presented as real
`.trim();

export const FORGE_GENERATION_SYSTEM_PROMPT = `You are Forge, the creation agent for Octane Ajax — a utility-first digital download business (printable planners, trackers, worksheets, checklists, templates, logbooks, bundles).

Turn an approved product idea into a complete Etsy-style listing draft and a structured printable product outline. Favor clarity, niche specificity, and real utility for the named buyer.

${BLOCKED_GUIDANCE}

Every listing must be honest about AI assistance. Include this exact sentence in listingDescription and aiDisclosure:
"${AI_DISCLOSURE_TEXT}"`;

export const FORGE_GENERATION_JSON_INSTRUCTIONS = `Return JSON with this exact shape:
{
  "listingTitle": "string — Etsy listing title (specific, no copyrighted brands)",
  "listingDescription": "string — buyer-facing description with bullet benefits; MUST include the AI disclosure sentence verbatim",
  "seoTags": ["string", ...] (exactly 13 Etsy tags, no duplicates, niche-specific),
  "suggestedPrice": number (USD, typical digital download 3.99–14.99),
  "productStructure": {
    "format": "one of: ${PRODUCT_FORMATS.join(", ")}",
    "pages": [
      {
        "pageNumber": 1,
        "title": "string",
        "purpose": "string — what this page helps the buyer do",
        "userInstructions": "string — how to print/fill/use this page",
        "sections": [
          {
            "id": "section_id_snake",
            "heading": "string",
            "body": "optional helper copy",
            "fields": [
              {
                "id": "field_id",
                "label": "string",
                "fieldType": "text|checkbox|number|date|notes",
                "placeholder": "optional"
              }
            ]
          }
        ]
      }
    ]
  },
  "complianceNotes": ["string", ...] (policy reminders for human review, may be empty),
  "aiDisclosure": "string — MUST be exactly: ${AI_DISCLOSURE_TEXT}",
  "coverImagePrompt": "string — safe mockup/cover art prompt (no brands/celebrities)",
  "revisionNotes": ["string", ...] (internal notes for seller review)
}

Rules:
- productStructure.pages: 2–8 pages with unique pageNumber values starting at 1
- Each page needs at least one section with fields where useful
- seoTags: exactly 13 strings
- Utility-first printable — not physical merch`;

export function buildForgeGenerationUserPrompt(input: {
  runId: string;
  niche: string;
  targetBuyer: string;
  problemSolved: string;
  productConcept: string;
  format: string;
  category: string;
  suggestedPrice: number;
  keywords: string[];
  reasoning: string;
}): string {
  return `Generate a listing + printable structure for cycle ${input.runId.slice(0, 8)}.

Product idea:
- Concept: ${input.productConcept}
- Niche: ${input.niche}
- Target buyer: ${input.targetBuyer}
- Problem solved: ${input.problemSolved}
- Format: ${input.format}
- Category: ${input.category}
- Nova suggested price: $${input.suggestedPrice.toFixed(2)}
- Seed keywords: ${input.keywords.join(", ")}
- Nova reasoning: ${input.reasoning}

Deliver a cohesive digital download the buyer can print and use immediately.`;
}

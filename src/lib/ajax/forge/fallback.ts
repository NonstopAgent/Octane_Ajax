import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  AI_DISCLOSURE_TEXT,
  ensureAiDisclosureInCopy,
  mapForgeStructureToDomain,
  type ForgeGenerationResult,
} from "@/lib/ajax/forge/types";
import { FORGE_PROMPT_VERSION } from "@/lib/ajax/forge/prompts";

const FALLBACK_PRICE = 24.99;

function padSeoTags(keywords: string[], concept: string): string[] {
  const base = [
    ...keywords.map((k) => k.trim()).filter(Boolean),
    "printable",
    "digital download",
    "instant download",
    "planner pdf",
    "etsy printable",
  ];
  const nicheTokens = concept
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 4);

  const merged = [...new Set([...base, ...nicheTokens])];
  while (merged.length < 13) {
    merged.push(`tag${merged.length + 1}`);
  }
  return merged.slice(0, 13);
}

/** Deterministic Forge output when LLM is unavailable (preserves legacy demo pricing). */
export function buildForgeFallbackResult(
  idea: NovaEvaluatedIdea,
): ForgeGenerationResult {
  const listingTitle = idea.productConcept;
  const listingDescription = ensureAiDisclosureInCopy(
    [
      idea.problemSolved,
      "",
      `Designed for: ${idea.targetBuyer}`,
      "",
      "What's included:",
      "- Printable PDF-ready pages (demo structure — PDF generation not wired yet)",
      "- Clear sections you can fill in or check off",
      "",
      idea.reasoning,
    ].join("\n"),
  );

  const structure = mapForgeStructureToDomain(
    {
      format: idea.format,
      pages: [
        {
          pageNumber: 1,
          title: "Cover & overview",
          purpose: "Orient the buyer and explain how to use the printable",
          userInstructions:
            "Print at 100% scale on US Letter or A4. Read the overview before filling inner pages.",
          sections: [
            {
              id: "overview",
              heading: "How to use this download",
              body: `This ${idea.format} supports: ${idea.problemSolved}`,
              fields: [
                {
                  id: "buyer_name",
                  label: "Your name",
                  fieldType: "text",
                  placeholder: "Optional",
                },
              ],
            },
          ],
        },
        {
          pageNumber: 2,
          title: "Weekly tracker",
          purpose: "Capture progress against the core problem",
          userInstructions:
            "Duplicate this page each week. Check off completed items and add notes in the margins.",
          sections: [
            {
              id: "weekly_log",
              heading: "This week",
              body: "Track what you tried and what helped.",
              fields: [
                {
                  id: "goal",
                  label: "Primary goal",
                  fieldType: "text",
                },
                {
                  id: "done",
                  label: "Completed",
                  fieldType: "checkbox",
                },
                {
                  id: "notes",
                  label: "Notes",
                  fieldType: "notes",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      aiDisclosure: AI_DISCLOSURE_TEXT,
      forgeMode: "fallback",
      coverImagePrompt: `Minimal flat cover for a ${idea.format} about ${idea.niche}, soft neutral palette, no logos or characters`,
    },
  );

  return {
    mode: "fallback",
    listingTitle,
    listingDescription,
    seoTags: padSeoTags(idea.keywords, idea.productConcept),
    suggestedPrice: FALLBACK_PRICE,
    productStructure: structure,
    complianceNotes: [
      "Demo fallback structure — verify claims and niche accuracy before publish.",
    ],
    aiDisclosure: AI_DISCLOSURE_TEXT,
    coverImagePrompt: String(structure.metadata?.coverImagePrompt ?? ""),
    revisionNotes: ["Deterministic Forge fallback (no LLM)."],
    promptVersion: FORGE_PROMPT_VERSION,
  };
}

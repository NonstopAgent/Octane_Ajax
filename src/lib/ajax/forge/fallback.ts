import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  AI_DISCLOSURE_TEXT,
  ensureAiDisclosureInCopy,
  mapForgeStructureToDomain,
  type ForgeGenerationResult,
  type ForgeLlmProductStructure,
} from "@/lib/ajax/forge/types";
const FALLBACK_PRICE = 9.99;

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

function buildSellableFallbackStructure(
  idea: NovaEvaluatedIdea,
): ForgeLlmProductStructure {
  const concept = idea.productConcept;
  return {
    format: idea.format,
    pages: [
      {
        pageNumber: 1,
        pageKind: "cover",
        title: concept,
        purpose: "Cover — orient the buyer to this printable pack",
        userInstructions: "Print or save this PDF. Start with the how-to page.",
        sections: [
          {
            id: "cover_meta",
            heading: "What's inside",
            body: `A ${idea.format} for ${idea.targetBuyer}: ${idea.problemSolved}`,
            fields: [
              {
                id: "owner",
                label: "Prepared for",
                fieldType: "text",
                placeholder: "Your name (optional)",
              },
            ],
          },
        ],
      },
      {
        pageNumber: 2,
        pageKind: "instructions",
        title: "How to use this download",
        purpose: "Explain print settings and workflow",
        userInstructions:
          "Read once before your first session. Duplicate worksheet pages as needed.",
        sections: [
          {
            id: "how_to",
            heading: "Quick start",
            body: "Print at 100% on US Letter or A4. Use pencil or PDF markup.",
            checklist: {
              id: "start_checklist",
              title: "Before you begin",
              items: [
                "Choose your start date",
                "Gather pens or digital markup tool",
                "Pick one worksheet to try first",
                "Set a 15-minute review reminder",
              ],
            },
          },
        ],
      },
      {
        pageNumber: 3,
        pageKind: "worksheet",
        title: "Weekly focus",
        purpose: "Capture the primary goal for the week",
        userInstructions: "Complete at the start of each week.",
        sections: [
          {
            id: "week_focus",
            heading: "This week's priority",
            fields: [
              { id: "goal", label: "Primary goal", fieldType: "text" },
              { id: "why", label: "Why it matters", fieldType: "notes" },
              {
                id: "metric",
                label: "How you'll measure progress",
                fieldType: "text",
              },
            ],
            table: {
              id: "week_days",
              headers: ["Day", "Focus block", "Done?"],
              rowCount: 7,
            },
          },
        ],
      },
      {
        pageNumber: 4,
        pageKind: "worksheet",
        title: "Daily log — Mon–Wed",
        purpose: "Track actions mid-week",
        userInstructions: "Fill one row per day. Add notes in the last column.",
        sections: [
          {
            id: "daily_log_a",
            heading: "Daily entries",
            table: {
              id: "log_a",
              headers: ["Date", "Action", "Outcome", "Notes"],
              rowCount: 6,
            },
            checklist: {
              id: "habits_a",
              items: [
                "Morning check-in",
                "Midday reset",
                "Evening shutdown",
              ],
            },
          },
        ],
      },
      {
        pageNumber: 5,
        pageKind: "worksheet",
        title: "Daily log — Thu–Sun",
        purpose: "Continue tracking through the week",
        userInstructions: "Duplicate this page if you need more rows.",
        sections: [
          {
            id: "daily_log_b",
            heading: "Daily entries",
            table: {
              id: "log_b",
              headers: ["Date", "Action", "Outcome", "Notes"],
              rowCount: 6,
            },
            fields: [
              { id: "wins", label: "Small wins", fieldType: "notes" },
              { id: "blockers", label: "Blockers", fieldType: "notes" },
            ],
          },
        ],
      },
      {
        pageNumber: 6,
        pageKind: "worksheet",
        title: "Resource & notes",
        purpose: "Capture links, supplies, and reminders",
        userInstructions: "Use during the week as a scratch pad.",
        sections: [
          {
            id: "resources",
            heading: "Resources",
            fields: Array.from({ length: 6 }, (_, i) => ({
              id: `res_${i + 1}`,
              label: `Item ${i + 1}`,
              fieldType: "text" as const,
            })),
            checklist: {
              id: "supplies",
              title: "Supplies / tools",
              items: [
                "Notebook or binder",
                "Printer paper",
                "Pen or stylus",
                "Folder for completed weeks",
              ],
            },
          },
        ],
      },
      {
        pageNumber: 7,
        pageKind: "worksheet",
        title: "Troubleshooting",
        purpose: "Note what to adjust when stuck",
        userInstructions: "Fill when something isn't working.",
        sections: [
          {
            id: "troubleshoot",
            heading: "If you're stuck",
            fields: [
              { id: "symptom", label: "What's not working?", fieldType: "notes" },
              { id: "tried", label: "What you tried", fieldType: "notes" },
              { id: "next", label: "Next experiment", fieldType: "text" },
            ],
          },
        ],
      },
      {
        pageNumber: 8,
        pageKind: "summary",
        title: "Week in review",
        purpose: "Reflect and plan the next cycle",
        userInstructions: "Complete at week end. Keep for your records.",
        sections: [
          {
            id: "review",
            heading: "Reflection",
            fields: [
              { id: "best", label: "Best outcome this week", fieldType: "text" },
              {
                id: "adjust",
                label: "One change for next week",
                fieldType: "notes",
              },
              {
                id: "rating",
                label: "Overall week (1–10)",
                fieldType: "number",
              },
            ],
            checklist: {
              id: "closeout",
              title: "Close-out",
              items: [
                "Archive or file this week",
                "Schedule next week's focus block",
                "Celebrate one win",
              ],
            },
          },
        ],
      },
    ],
  };
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
      "- 8-page printable PDF pack (cover, instructions, worksheets, review)",
      "- Tables, checklists, and fillable fields",
      "",
      idea.reasoning,
    ].join("\n"),
  );

  const structure = mapForgeStructureToDomain(
    buildSellableFallbackStructure(idea),
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
    complianceNotes: [],
    aiDisclosure: AI_DISCLOSURE_TEXT,
    coverImagePrompt: String(structure.metadata?.coverImagePrompt ?? ""),
    revisionNotes: ["Deterministic Forge fallback (no LLM)."],
  };
}

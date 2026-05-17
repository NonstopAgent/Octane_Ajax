import {
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  AGENT_SLUGS,
} from "@/lib/ajax/constants";
import type { AgentSlug } from "@/lib/ajax/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Single human feedback row (maps from agent_feedback). */
export type FeedbackRecord = {
  id: string;
  agentSlug: AgentSlug;
  feedbackType: string;
  feedbackText: string;
  relatedListingId: string | null;
  listingTitle: string | null;
  createdAt: string;
};

/** Deterministic note derived from feedback keywords (no LLM). */
export type LearningNote = {
  id: string;
  sourceFeedbackId: string;
  ruleId: string;
  note: string;
};

/**
 * Bundle for future LLM system prompts — pass as structured context, not raw DB rows.
 * @example
 * const prompt = buildLlmPromptSection(profile.promptContext);
 */
export type AgentPromptMemory = {
  agentSlug: AgentSlug;
  displayName: string;
  role: string;
  systemHints: string[];
  recentHumanFeedback: string[];
  learningNotes: string[];
  stats: {
    approvals: number;
    rejections: number;
    totalFeedback: number;
  };
};

export type AgentMemoryProfile = {
  slug: AgentSlug;
  displayName: string;
  role: string;
  recentFeedback: FeedbackRecord[];
  approvalCount: number;
  rejectionCount: number;
  learningNotes: LearningNote[];
  promptContext: AgentPromptMemory;
};

const AGENT_ORDER: AgentSlug[] = [
  AGENT_SLUGS.NOVA,
  AGENT_SLUGS.FORGE,
  AGENT_SLUGS.PIXEL,
];

type LearningRule = {
  id: string;
  pattern: RegExp;
  note: string;
  /** If set, only apply for these feedback types. */
  types?: string[];
};

const LEARNING_RULES: LearningRule[] = [
  {
    id: "contrast",
    pattern: /contrast/i,
    note: "Improve text contrast in future designs.",
    types: ["rejection", "quality", "style", "other"],
  },
  {
    id: "too_generic",
    pattern: /too generic|generic/i,
    note: "Use more specific niche language.",
  },
  {
    id: "similar_style",
    pattern: /similar style|repeat|same style|this style/i,
    note: "Repeat this visual/listing pattern.",
    types: ["approval_note"],
  },
  {
    id: "title",
    pattern: /title/i,
    note: "Sharpen product titles for clarity and search intent.",
  },
  {
    id: "price",
    pattern: /price|pricing|expensive|cheap/i,
    note: "Review pricing against niche expectations.",
  },
  {
    id: "mockup",
    pattern: /mockup|image|photo|visual/i,
    note: "Enhance mockup quality and visual storytelling.",
  },
  {
    id: "hashtag",
    pattern: /hashtag|caption|copy|text/i,
    note: "Tailor captions and hashtags to the target platform.",
    types: ["rejection", "quality", "other"],
  },
  {
    id: "niche",
    pattern: /niche|audience|target/i,
    note: "Focus on clearer niche positioning in research and copy.",
  },
  {
    id: "tone",
    pattern: /tone|voice|brand/i,
    note: "Align tone and brand voice with prior approvals.",
  },
];

const DEFAULT_APPROVAL_NOTE =
  "Human approved recent work — bias toward repeating successful patterns.";

const DEFAULT_REJECTION_NOTE =
  "Human rejected recent work — review feedback before similar outputs.";

function isApprovalType(type: string) {
  return type === "approval_note";
}

function isRejectionType(type: string) {
  return type === "rejection";
}

/** Derive learning notes from one feedback item using keyword rules. */
export function deriveLearningNotesFromFeedback(
  feedback: FeedbackRecord,
): LearningNote[] {
  const notes: LearningNote[] = [];
  const text = feedback.feedbackText;

  for (const rule of LEARNING_RULES) {
    if (rule.types && !rule.types.includes(feedback.feedbackType)) {
      continue;
    }
    if (rule.pattern.test(text)) {
      notes.push({
        id: `${feedback.id}:${rule.id}`,
        sourceFeedbackId: feedback.id,
        ruleId: rule.id,
        note: rule.note,
      });
    }
  }

  if (
    isApprovalType(feedback.feedbackType) &&
    notes.length === 0 &&
    /approv|good|great|yes/i.test(text)
  ) {
    notes.push({
      id: `${feedback.id}:approval_default`,
      sourceFeedbackId: feedback.id,
      ruleId: "approval_default",
      note: DEFAULT_APPROVAL_NOTE,
    });
  }

  if (isRejectionType(feedback.feedbackType) && notes.length === 0) {
    notes.push({
      id: `${feedback.id}:rejection_default`,
      sourceFeedbackId: feedback.id,
      ruleId: "rejection_default",
      note: DEFAULT_REJECTION_NOTE,
    });
  }

  return notes;
}

/** Dedupe notes by text, newest sources win. */
export function dedupeLearningNotes(notes: LearningNote[]): LearningNote[] {
  const seen = new Set<string>();
  const out: LearningNote[] = [];
  for (const note of notes) {
    if (seen.has(note.note)) continue;
    seen.add(note.note);
    out.push(note);
  }
  return out;
}

export function buildAgentMemoryProfile(
  slug: AgentSlug,
  allFeedback: FeedbackRecord[],
  options?: { recentLimit?: number },
): AgentMemoryProfile {
  const limit = options?.recentLimit ?? 12;
  const forAgent = allFeedback
    .filter((f) => f.agentSlug === slug)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  const recentFeedback = forAgent.slice(0, limit);
  const approvalCount = forAgent.filter((f) =>
    isApprovalType(f.feedbackType),
  ).length;
  const rejectionCount = forAgent.filter((f) =>
    isRejectionType(f.feedbackType),
  ).length;

  const learningNotes = dedupeLearningNotes(
    forAgent.flatMap(deriveLearningNotesFromFeedback),
  ).slice(0, 8);

  const promptContext = buildAgentPromptMemory({
    slug,
    recentFeedback,
    learningNotes,
    approvalCount,
    rejectionCount,
  });

  return {
    slug,
    displayName: AGENT_DISPLAY_NAMES[slug],
    role: AGENT_ROLES[slug],
    recentFeedback,
    approvalCount,
    rejectionCount,
    learningNotes,
    promptContext,
  };
}

export function buildAllAgentMemories(
  allFeedback: FeedbackRecord[],
): AgentMemoryProfile[] {
  return AGENT_ORDER.map((slug) => buildAgentMemoryProfile(slug, allFeedback));
}

/** Future-ready: serialize memory for LLM system / tool prompts. */
export function buildAgentPromptMemory(input: {
  slug: AgentSlug;
  recentFeedback: FeedbackRecord[];
  learningNotes: LearningNote[];
  approvalCount: number;
  rejectionCount: number;
}): AgentPromptMemory {
  const { slug, recentFeedback, learningNotes, approvalCount, rejectionCount } =
    input;

  const systemHints = [
    `You are ${AGENT_DISPLAY_NAMES[slug]}, the ${AGENT_ROLES[slug]} for Octane Ajax.`,
    "Respect human-in-the-loop feedback below when making decisions.",
    "Do not invent feedback; only use provided memory.",
  ];

  return {
    agentSlug: slug,
    displayName: AGENT_DISPLAY_NAMES[slug],
    role: AGENT_ROLES[slug],
    systemHints,
    recentHumanFeedback: recentFeedback.map(
      (f) =>
        `[${f.feedbackType}] ${f.feedbackText}${f.listingTitle ? ` (listing: ${f.listingTitle})` : ""}`,
    ),
    learningNotes: learningNotes.map((n) => n.note),
    stats: {
      approvals: approvalCount,
      rejections: rejectionCount,
      totalFeedback: approvalCount + rejectionCount,
    },
  };
}

/**
 * Plain-text block suitable for injection into an LLM prompt later.
 */
export function formatPromptMemoryForLlm(context: AgentPromptMemory): string {
  const lines = [
    `## Agent: ${context.displayName} (${context.role})`,
    "",
    "### System hints",
    ...context.systemHints.map((h) => `- ${h}`),
    "",
    "### Learning notes",
    ...(context.learningNotes.length
      ? context.learningNotes.map((n) => `- ${n}`)
      : ["- (none yet)"]),
    "",
    "### Recent human feedback",
    ...(context.recentHumanFeedback.length
      ? context.recentHumanFeedback.map((f) => `- ${f}`)
      : ["- (none yet)"]),
    "",
    `### Stats: ${context.stats.approvals} approvals, ${context.stats.rejections} rejections`,
  ];
  return lines.join("\n");
}

type FeedbackRow = {
  id: string;
  agent_slug: string;
  feedback_type: string;
  feedback_text: string;
  related_listing_id: string | null;
  created_at: string;
  product_listings: { title: string | null } | null;
};

/** Load all feedback for the current user (RLS-scoped). */
export async function fetchAgentFeedback(
  supabase: Supabase,
  userId: string,
): Promise<FeedbackRecord[]> {
  const { data, error } = await supabase
    .from(TABLES.FEEDBACK)
    .select(
      `
      id,
      agent_slug,
      feedback_type,
      feedback_text,
      related_listing_id,
      created_at,
      product_listings ( title )
    `,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  return ((data ?? []) as FeedbackRow[]).map((row) => ({
    id: row.id,
    agentSlug: row.agent_slug as AgentSlug,
    feedbackType: row.feedback_type,
    feedbackText: row.feedback_text,
    relatedListingId: row.related_listing_id,
    listingTitle: row.product_listings?.title ?? null,
    createdAt: row.created_at,
  }));
}

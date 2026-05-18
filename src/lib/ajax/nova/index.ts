export {
  buildFakeProductIdeas,
  mapFakeDraftsToNovaRaw,
  type FakeIdeaDraft,
} from "@/lib/ajax/nova/fallback";

export {
  NOVA_PROMPT_VERSION,
  NovaLlmIdeaSchema,
  NovaLlmResponseSchema,
  mapLlmIdeaToRaw,
  normalizeProductCategory,
  normalizeProductFormat,
  type NovaEvaluatedIdea,
  type NovaIdeationMode,
  type NovaIdeationResult,
  type NovaLlmIdea,
  type NovaLlmResponse,
  type NovaRawIdea,
} from "@/lib/ajax/nova/types";

export {
  NOVA_IDEATION_JSON_INSTRUCTIONS,
  NOVA_IDEATION_SYSTEM_PROMPT,
  buildNovaIdeationUserPrompt,
  type NovaPastContext,
} from "@/lib/ajax/nova/prompts";

export {
  buildNovaPastContext,
  dedupePreserveOrder,
  extractNicheFromIdea,
  extractNichesFromListings,
  fetchNovaPastContext,
  hasNovaPastContext,
} from "@/lib/ajax/nova/past-context";

export {
  mapNovaIdeasToDbInserts,
  pickForgeIdeaCandidate,
  runNovaIdeation,
  type NovaIdeationOptions,
} from "@/lib/ajax/nova/service";

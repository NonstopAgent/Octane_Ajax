export {
  AI_DISCLOSURE_TEXT,
  FORGE_PROMPT_VERSION,
  ForgeLlmResponseSchema,
  ForgeProductStructureSchema,
  ensureAiDisclosureInCopy,
  mapForgeStructureToDomain,
  type ForgeGenerationInput,
  type ForgeGenerationMode,
  type ForgeGenerationResult,
  type ForgeLlmResponse,
} from "@/lib/ajax/forge/types";

export {
  FORGE_GENERATION_JSON_INSTRUCTIONS,
  FORGE_GENERATION_SYSTEM_PROMPT,
  buildForgeGenerationUserPrompt,
} from "@/lib/ajax/forge/prompts";

export { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";

export {
  forgeResultToCompliance,
  runForgeGeneration,
  type ForgeGenerationOptions,
} from "@/lib/ajax/forge/service";

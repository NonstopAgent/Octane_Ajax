import OpenAI from "openai";

/** True when server OpenAI API key is present. */
export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Returns OPENAI_API_KEY from server env only.
 * Never reads NEXT_PUBLIC_* — keys must not reach the client bundle.
 */
export function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in server environment variables (not NEXT_PUBLIC_*).",
    );
  }
  return apiKey;
}

/**
 * Factory for the official OpenAI SDK client (server-only).
 * Default timeout is 12 s per call so retries + Vercel limits stay safe:
 *   Nova  (maxDuration 30 s): 2 attempts × 12 s + 0.5 s backoff ≈ 24.5 s ✓
 *   Forge (maxDuration 60 s): 2 attempts × 12 s + 0.5 s backoff ≈ 24.5 s ✓
 */
export function createOpenAiClient(options?: {
  apiKey?: string;
  baseURL?: string;
  /** Per-request timeout in ms. Defaults to 12 000 (12 s). */
  timeout?: number;
}): OpenAI {
  return new OpenAI({
    apiKey: options?.apiKey ?? getOpenAiApiKey(),
    baseURL: options?.baseURL,
    timeout: options?.timeout ?? 12_000,
  });
}

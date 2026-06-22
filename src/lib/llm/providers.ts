/**
 * Multi-model routing — server only.
 *
 * Each logical task (Nova ideation, Pixel marketing, War Room strategy, etc.)
 * can run on the provider/model best suited to it. Selection is env-overridable
 * and ALWAYS falls back to OpenAI when the chosen provider has no API key, so
 * the app behaves exactly as before until keys are added in the environment.
 *
 * Uses REST (fetch) for Anthropic + Google so no extra SDK dependencies are
 * required. OpenAI calls stay in `llm/json.ts`.
 */
import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmMessage,
  LlmTask,
  LlmTokenUsage,
} from "@/lib/llm/types";

export type LlmProvider = "openai" | "anthropic" | "google";

const JSON_ONLY =
  "Respond with a single valid JSON object only. No markdown fences, prose, or commentary.";

/** Default provider/model per task. Override per task via LLM_<TASK>_PROVIDER / LLM_<TASK>_MODEL. */
const DEFAULT_TASK_ROUTES: Record<
  LlmTask,
  { provider: LlmProvider; model: string }
> = {
  ideation: { provider: "anthropic", model: "claude-sonnet-4-6" },
  strategy: { provider: "anthropic", model: "claude-sonnet-4-6" },
  marketing: { provider: "google", model: "gemini-2.0-flash" },
  scoring: { provider: "google", model: "gemini-2.0-flash" },
  listing: { provider: "openai", model: "gpt-4o-mini" },
  default: { provider: "openai", model: "gpt-4o-mini" },
};

function providerKey(provider: LlmProvider): string | undefined {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (provider === "google")
    return (
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
    );
  return process.env.OPENAI_API_KEY?.trim();
}

export function isProviderConfigured(provider: LlmProvider): boolean {
  return Boolean(providerKey(provider));
}

function isProvider(value: string | undefined): value is LlmProvider {
  return value === "openai" || value === "anthropic" || value === "google";
}

function envOverride(task: LlmTask): {
  provider?: LlmProvider;
  model?: string;
} {
  const up = task.toUpperCase();
  const provider = process.env[`LLM_${up}_PROVIDER`]?.trim().toLowerCase();
  const model = process.env[`LLM_${up}_MODEL`]?.trim();
  return {
    provider: isProvider(provider) ? provider : undefined,
    model: model || undefined,
  };
}

/**
 * Resolves provider + model for a task. Falls back to OpenAI if the preferred
 * provider has no API key configured.
 */
export function resolveTaskModel(task: LlmTask): {
  provider: LlmProvider;
  model: string;
} {
  const base = DEFAULT_TASK_ROUTES[task] ?? DEFAULT_TASK_ROUTES.default;
  const over = envOverride(task);
  let provider = over.provider ?? base.provider;
  let model = over.model ?? base.model;

  if (!isProviderConfigured(provider)) {
    provider = "openai";
    model = process.env.LLM_FALLBACK_MODEL?.trim() || "gpt-4o-mini";
  }
  return { provider, model };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function splitMessages(messages: LlmMessage[]): {
  system: string;
  user: string;
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content);
  const user = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");
  return { system: [JSON_ONLY, ...system].join("\n\n"), user };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ? fence[1].trim() : trimmed;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
  temperature?: number,
  maxTokens?: number,
): Promise<{ text: string; usage: LlmTokenUsage }> {
  const key = providerKey("anthropic");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured.");
  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens ?? 4096,
        temperature,
        system,
        messages: [{ role: "user", content: user }],
      }),
    },
    timeoutMs,
  );
  const json = (await res.json()) as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Anthropic error (${res.status}): ${json.error?.message ?? "unknown"}`,
    );
  }
  const text = json.content?.map((c) => c.text ?? "").join("") ?? "";
  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  return {
    text,
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function callGoogle(
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
  temperature?: number,
): Promise<{ text: string; usage: LlmTokenUsage }> {
  const key = providerKey("google");
  if (!key) throw new Error("GEMINI_API_KEY not configured.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${key}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature },
      }),
    },
    timeoutMs,
  );
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Gemini error (${res.status}): ${json.error?.message ?? "unknown"}`,
    );
  }
  const text =
    json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  return {
    text,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

/**
 * Completes a JSON request via a non-OpenAI provider, validating the parsed
 * output against the request's Zod schema. Throws on failure so the caller
 * (completeJson) can fall back to OpenAI.
 */
export async function completeJsonViaProvider<T>(
  provider: LlmProvider,
  model: string,
  request: JsonCompletionRequest<T>,
): Promise<JsonCompletionResult<T>> {
  const timeoutMs = request.timeout ?? 30_000;
  const messages = request.jsonInstructions?.trim()
    ? [
        ...request.messages,
        { role: "system" as const, content: request.jsonInstructions },
      ]
    : request.messages;
  const { system, user } = splitMessages(messages);

  const maxRetries = request.maxRetries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { text, usage } =
        provider === "anthropic"
          ? await callAnthropic(
              model,
              system,
              user,
              timeoutMs,
              request.options?.temperature,
              request.options?.maxTokens,
            )
          : await callGoogle(
              model,
              system,
              user,
              timeoutMs,
              request.options?.temperature,
            );
      const parsed: unknown = JSON.parse(extractJson(text));
      const data = request.schema.parse(parsed);
      return { data, model, usage, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Provider JSON completion failed.");
}

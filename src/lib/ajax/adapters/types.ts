/**
 * Shared adapter types for Octane Ajax external integrations.
 *
 * IMPORTANT — Server-side only:
 * - Instantiate adapters in API routes, Server Actions, or background jobs.
 * - Never import adapter implementations into Client Components.
 * - Never expose API keys via NEXT_PUBLIC_* env vars.
 */

/** All adapters start in demo mode until wired to live credentials. */
export type AdapterMode = "demo" | "live";

/** Standard wrapper for stub responses (live mode will use the same shape later). */
export type AdapterResult<T> = {
  mode: AdapterMode;
  /** Human-readable status; includes "demo mode" for stubs. */
  message: string;
  data: T;
  /** ISO timestamp when the adapter handled the call. */
  handledAt: string;
};

export type AdapterErrorCode =
  | "NOT_CONFIGURED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}

export function demoResult<T>(message: string, data: T): AdapterResult<T> {
  return {
    mode: "demo",
    message: `[demo mode] ${message}`,
    data,
    handledAt: new Date().toISOString(),
  };
}

/** Base config passed when constructing live adapters later. */
export type AdapterConfig = {
  mode?: AdapterMode;
};

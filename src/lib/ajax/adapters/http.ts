/**
 * HTTP discipline for marketplace adapters (2026-07-25 audit, H11).
 *
 * Before this, every one of the ~50 Etsy/Printify calls went out with no
 * timeout and no 429/5xx handling: Node's fetch never times out on its own,
 * so ONE hung connection mid-pass sailed past the autopilot's soft budget
 * and was hard-killed by the platform at maxDuration — with no summary event
 * ever written. And the only rate-limit awareness in the whole repo was a
 * substring check on an OpenAI error message.
 *
 * Rules:
 * - Every request gets a hard AbortSignal timeout (20s GETs, 90s mutations —
 *   Etsy video uploads and base64 image bodies legitimately run long).
 * - GETs retry up to 3 times on 429/5xx and network errors, honoring
 *   Retry-After (capped at 15s), exponential backoff otherwise.
 * - Mutations NEVER retry (createDraftListing, submitOrder,
 *   uploadListingVideo are not idempotent) — timeout only.
 * - A caller-supplied AbortSignal wins over the default timeout.
 */

const GET_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 90_000;
const MAX_GET_RETRIES = 3;
const RETRY_AFTER_CAP_MS = 15_000;

export type HttpDisciplineOptions = {
  getTimeoutMs?: number;
  mutationTimeoutMs?: number;
  maxGetRetries?: number;
  /** Test hook — replaces real waiting between retries. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const raw = Number(res.headers.get("retry-after"));
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(raw * 1000, RETRY_AFTER_CAP_MS);
  }
  return 500 * 2 ** attempt;
}

/** Wraps a fetch implementation with timeouts + bounded idempotent retry. */
export function withHttpDiscipline(
  base: typeof fetch = fetch,
  opts: HttpDisciplineOptions = {},
): typeof fetch {
  const getTimeout = opts.getTimeoutMs ?? GET_TIMEOUT_MS;
  const mutationTimeout = opts.mutationTimeoutMs ?? MUTATION_TIMEOUT_MS;
  const maxRetries = opts.maxGetRetries ?? MAX_GET_RETRIES;
  const sleep = opts.sleep ?? defaultSleep;

  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    const timeoutMs = idempotent ? getTimeout : mutationTimeout;

    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await base(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (idempotent && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw err;
      }
      if (
        idempotent &&
        attempt < maxRetries &&
        (res.status === 429 || res.status >= 500)
      ) {
        await sleep(retryDelayMs(res, attempt));
        attempt += 1;
        continue;
      }
      return res;
    }
  };

  return wrapped as typeof fetch;
}

/**
 * Reject oversized remote bodies BEFORE buffering (H11/M8): `arrayBuffer()`
 * on an attacker- or CDN-supplied URL used to buffer unbounded bytes into
 * the lambda heap. Throws when Content-Length exceeds `maxBytes`; when the
 * header is absent the caller still gets the response (streaming caps are
 * not worth the complexity here) but the common oversized case fails fast.
 */
export function assertBodySize(
  res: Response,
  maxBytes: number,
  label: string,
): void {
  const raw = Number(res.headers.get("content-length"));
  if (Number.isFinite(raw) && raw > maxBytes) {
    throw new Error(
      `${label} is ${Math.round(raw / 1024 / 1024)}MB — exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB cap.`,
    );
  }
}

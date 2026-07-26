import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBodySize, withHttpDiscipline } from "@/lib/ajax/adapters/http";

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "{}", { status, headers });
}

describe("withHttpDiscipline (H11)", () => {
  it("retries a GET through 429s and returns the eventual success", async () => {
    let calls = 0;
    const delays: number[] = [];
    const base = (async () => {
      calls += 1;
      return calls < 3 ? res(429, { "retry-after": "1" }) : res(200);
    }) as unknown as typeof fetch;

    const wrapped = withHttpDiscipline(base, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const out = await wrapped("https://api.example.com/x");

    assert.equal(out.status, 200);
    assert.equal(calls, 3);
    // Retry-After: 1 → 1000ms honored on both waits.
    assert.deepEqual(delays, [1000, 1000]);
  });

  it("gives up after the retry budget and returns the last response", async () => {
    let calls = 0;
    const base = (async () => {
      calls += 1;
      return res(503);
    }) as unknown as typeof fetch;

    const wrapped = withHttpDiscipline(base, {
      maxGetRetries: 2,
      sleep: async () => {},
    });
    const out = await wrapped("https://api.example.com/x");

    assert.equal(out.status, 503);
    assert.equal(calls, 3); // initial + 2 retries
  });

  it("NEVER retries mutations — a 429 POST comes back once", async () => {
    let calls = 0;
    const base = (async () => {
      calls += 1;
      return res(429);
    }) as unknown as typeof fetch;

    const wrapped = withHttpDiscipline(base, { sleep: async () => {} });
    const out = await wrapped("https://api.example.com/x", { method: "POST" });

    assert.equal(out.status, 429);
    assert.equal(calls, 1, "submitOrder-shaped calls must not be re-fired");
  });

  it("retries a GET whose connection died, rethrows for mutations", async () => {
    let getCalls = 0;
    const base = (async (_url: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        getCalls += 1;
        if (getCalls < 2) throw new Error("socket hang up");
        return res(200);
      }
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    const wrapped = withHttpDiscipline(base, { sleep: async () => {} });
    const ok = await wrapped("https://api.example.com/x");
    assert.equal(ok.status, 200);

    await assert.rejects(
      wrapped("https://api.example.com/x", { method: "PUT" }),
      /socket hang up/,
    );
  });

  it("attaches a timeout signal when the caller did not provide one", async () => {
    let sawSignal = false;
    const base = (async (_url: unknown, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return res(200);
    }) as unknown as typeof fetch;

    await withHttpDiscipline(base)("https://api.example.com/x");
    assert.equal(sawSignal, true);
  });
});

describe("assertBodySize (H11/M8)", () => {
  it("rejects oversized bodies before buffering", () => {
    const big = new Response("x", {
      headers: { "content-length": String(50 * 1024 * 1024) },
    });
    assert.throws(
      () => assertBodySize(big, 30 * 1024 * 1024, "Artwork file"),
      /exceeds the 30MB cap/,
    );
  });

  it("lets normal and unsized bodies through", () => {
    const small = new Response("x", {
      headers: { "content-length": "1024" },
    });
    assertBodySize(small, 30 * 1024 * 1024, "Artwork file");
    const unsized = new Response("x");
    assertBodySize(unsized, 30 * 1024 * 1024, "Artwork file");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchImageBuffer,
  IMAGE_FETCH_TIMEOUT_MS,
  MAX_FETCHED_IMAGE_BYTES,
} from "@/lib/ajax/adapters/image-generator";

/** A streaming Response of `size` bytes, delivered in 64KB chunks. */
function streamed(size: number, headers: Record<string, string> = {}) {
  const CHUNK = 64 * 1024;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) {
        controller.close();
        return;
      }
      const n = Math.min(CHUNK, size - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", ...headers },
  });
}

describe("fetchImageBuffer", () => {
  it("returns the image and its content type", async () => {
    const { buffer, mimeType } = await fetchImageBuffer(
      "https://cdn.example.com/pet.png",
      async () => streamed(128 * 1024),
    );
    assert.equal(buffer.byteLength, 128 * 1024);
    assert.equal(mimeType, "image/png");
  });

  it("rejects an honestly-declared oversized body before reading it", async () => {
    let bodyRead = false;
    const res = new Response("x", {
      headers: {
        "content-type": "image/png",
        "content-length": String(MAX_FETCHED_IMAGE_BYTES + 1),
      },
    });
    Object.defineProperty(res, "body", {
      get() {
        bodyRead = true;
        return null;
      },
    });
    await assert.rejects(
      () => fetchImageBuffer("https://cdn.example.com/huge.png", async () => res),
      /too large/i,
    );
    assert.equal(bodyRead, false, "read the body despite an oversized header");
  });

  it("stops a body that LIES about its length, mid-download", async () => {
    // Content-Length is attacker-controlled: absent, or understated. The
    // ceiling has to hold on the bytes actually arriving (audit M8).
    await assert.rejects(
      () =>
        fetchImageBuffer(
          "https://cdn.example.com/liar.png",
          async () =>
            streamed(MAX_FETCHED_IMAGE_BYTES + 512 * 1024, {
              "content-length": "1024",
            }),
        ),
      /too large/i,
    );
  });

  it("stops an unbounded body with no length header at all", async () => {
    await assert.rejects(
      () =>
        fetchImageBuffer("https://cdn.example.com/endless.png", async () =>
          streamed(MAX_FETCHED_IMAGE_BYTES + 1024 * 1024),
        ),
      /too large/i,
    );
  });

  it("accepts a body right at the ceiling", async () => {
    const { buffer } = await fetchImageBuffer(
      "https://cdn.example.com/exact.png",
      async () => streamed(MAX_FETCHED_IMAGE_BYTES),
    );
    assert.equal(buffer.byteLength, MAX_FETCHED_IMAGE_BYTES);
  });

  it("passes an abort signal so a dead host cannot hold the function open", async () => {
    let sawSignal = false;
    await fetchImageBuffer("https://cdn.example.com/pet.png", async (_u, init) => {
      sawSignal = Boolean((init as RequestInit | undefined)?.signal);
      return streamed(1024);
    });
    assert.equal(sawSignal, true);
    assert.ok(IMAGE_FETCH_TIMEOUT_MS > 0 && IMAGE_FETCH_TIMEOUT_MS <= 60_000);
  });

  it("surfaces a non-2xx response instead of buffering the error page", async () => {
    await assert.rejects(
      () =>
        fetchImageBuffer(
          "https://cdn.example.com/gone.png",
          async () => new Response("nope", { status: 404 }),
        ),
      /Failed to fetch image \(404\)/,
    );
  });
});

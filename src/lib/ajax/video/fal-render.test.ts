import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildFalInput,
  falRequestBase,
  isVideoRenderConfigured,
  pollVideoRender,
  submitVideoRender,
} from "@/lib/ajax/video/fal-render";
import { buildVideoSpec } from "@/lib/ajax/pixel/video-spec";

const spec = buildVideoSpec({
  productTitle: "Personalized Gotcha Day Dog Mug",
  niche: "rescue dog mom gotcha day gift",
  format: "mug",
  mockupCount: 3,
});

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("buildFalInput", () => {
  it("forces 9:16, maps duration, and keeps the product faithful", () => {
    const input = buildFalInput(spec, "https://img/mock.png");
    assert.equal(input.aspect_ratio, "9:16");
    assert.equal(input.duration, "10");
    assert.equal(input.image_url, "https://img/mock.png");
    assert.match(input.prompt, /EXACTLY/);
  });
});

describe("fal-render (configured)", () => {
  beforeEach(() => {
    process.env.FAL_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.FAL_KEY;
    delete process.env.FAL_VIDEO_MODEL;
  });

  it("submits and returns a request id, with a Key auth header", async () => {
    let seenAuth = "";
    let seenBody = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenAuth = String(
        (init?.headers as Record<string, string>)?.Authorization ?? "",
      );
      seenBody = String(init?.body ?? "");
      return res({ request_id: "req-1" });
    }) as unknown as typeof fetch;

    const out = await submitVideoRender(
      { imageUrl: "https://img/mock.png", spec },
      { fetchImpl },
    );
    assert.equal(out.ok, true);
    assert.equal(out.status, "pending");
    assert.equal(out.requestId, "req-1");
    assert.match(seenAuth, /^Key /);
    assert.match(seenBody, /image_url/);
  });

  it("reports failure when submit is rejected", async () => {
    const fetchImpl = (async () =>
      res({ detail: "bad" }, false, 422)) as unknown as typeof fetch;
    const out = await submitVideoRender(
      { imageUrl: "https://img/mock.png", spec },
      { fetchImpl },
    );
    assert.equal(out.ok, false);
    assert.equal(out.status, "failed");
  });

  it("polls pending, then returns the MP4 URL on completion", async () => {
    const pending = (async () =>
      res({ status: "IN_PROGRESS" })) as unknown as typeof fetch;
    const p = await pollVideoRender("req-1", { fetchImpl: pending });
    assert.equal(p.status, "pending");

    const completed = (async (url: string) =>
      url.endsWith("/status")
        ? res({ status: "COMPLETED" })
        : res({ video: { url: "https://fal.media/out.mp4" } })) as unknown as typeof fetch;
    const done = await pollVideoRender("req-1", { fetchImpl: completed });
    assert.equal(done.ok, true);
    assert.equal(done.status, "completed");
    assert.equal(done.videoUrl, "https://fal.media/out.mp4");
  });

  it("polls the BASE app id, not the full model subpath", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return res({ status: "IN_QUEUE" });
    }) as unknown as typeof fetch;
    await pollVideoRender("req-9", { fetchImpl });
    assert.match(
      seen[0]!,
      /^https:\/\/queue\.fal\.run\/fal-ai\/kling-video\/requests\/req-9\/status$/,
    );
  });

  it("treats a 404/unknown status as terminal failure, never pending", async () => {
    const fetchImpl = (async () =>
      res({ detail: "Not found" }, false, 404)) as unknown as typeof fetch;
    const out = await pollVideoRender("req-lost", { fetchImpl });
    assert.equal(out.ok, false);
    assert.equal(out.status, "failed");
    assert.match(out.error ?? "", /404|Not found/);
  });
});

describe("falRequestBase", () => {
  it("returns the first two path segments", () => {
    assert.equal(
      falRequestBase("fal-ai/kling-video/v1/standard/image-to-video"),
      "fal-ai/kling-video",
    );
    assert.equal(falRequestBase("fal-ai/simple-model"), "fal-ai/simple-model");
  });
});

describe("fal-render (not configured)", () => {
  it("is dormant without FAL_KEY", async () => {
    delete process.env.FAL_KEY;
    assert.equal(isVideoRenderConfigured(), false);
    const out = await submitVideoRender({ imageUrl: "https://img/mock.png", spec });
    assert.equal(out.ok, false);
    assert.match(out.error ?? "", /FAL_KEY/);
  });
});

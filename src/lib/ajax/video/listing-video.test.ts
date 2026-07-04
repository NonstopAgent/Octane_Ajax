import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderAndAttachListingVideo } from "@/lib/ajax/video/listing-video";

function res(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

afterEach(() => {
  delete process.env.FAL_KEY;
});

describe("renderAndAttachListingVideo", () => {
  it("skips (does not throw) when FAL_KEY is not set", async () => {
    delete process.env.FAL_KEY;
    const out = await renderAndAttachListingVideo({
      adapter: { uploadListingVideo: async () => ({ listing_video_id: "x" }) },
      listingId: "L1",
      shopId: "S1",
      accessToken: "T1",
      mockupBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      title: "Dog Mom Mug",
    });
    assert.equal(out.ok, false);
    assert.equal((out as { skipped?: boolean }).skipped, true);
  });

  it("renders a 1:1 clip and uploads it to the listing", async () => {
    process.env.FAL_KEY = "test-key";

    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("fal.media"))
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
        } as unknown as Response;
      if (u.endsWith("/status")) return res({ status: "COMPLETED" });
      if (u.includes("/requests/"))
        return res({ video: { url: "https://fal.media/out.mp4" } });
      return res({ request_id: "r1" });
    }) as unknown as typeof fetch;

    let uploaded: { isBuffer: boolean; fname: string; ratioSeen?: boolean } | null =
      null;
    const adapter = {
      uploadListingVideo: async (
        _listingId: string,
        buf: Buffer,
        fname: string,
      ) => {
        uploaded = { isBuffer: Buffer.isBuffer(buf), fname };
        return { listing_video_id: "vid-1" };
      },
    };

    const out = await renderAndAttachListingVideo({
      adapter,
      listingId: "L1",
      shopId: "S1",
      accessToken: "T1",
      mockupBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      title: "Dog Mom Gotcha Day Mug",
      fetchImpl,
      maxWaitMs: 1000,
      pollIntervalMs: 1,
      sleep: async () => {},
    });

    assert.equal(out.ok, true);
    assert.equal((out as { etsyVideoId: string }).etsyVideoId, "vid-1");
    assert.equal(uploaded!.isBuffer, true);
    assert.match(uploaded!.fname, /\.mp4$/);
  });
});

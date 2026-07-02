import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildShareSaveUrl,
  extractEtsyListingId,
  getShareSaveBaseUrl,
} from "@/lib/etsy/share-link";

const ORIGINAL_ENV = process.env.ETSY_SHARE_SAVE_URL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ETSY_SHARE_SAVE_URL;
  } else {
    process.env.ETSY_SHARE_SAVE_URL = ORIGINAL_ENV;
  }
});

describe("getShareSaveBaseUrl", () => {
  it("defaults to the operator share domain", () => {
    delete process.env.ETSY_SHARE_SAVE_URL;
    assert.equal(getShareSaveBaseUrl(), "https://octaneajax.etsy.com");
  });

  it("normalizes env overrides (scheme + trailing slash)", () => {
    process.env.ETSY_SHARE_SAVE_URL = "myshop.etsy.com/";
    assert.equal(getShareSaveBaseUrl(), "https://myshop.etsy.com");
  });
});

describe("extractEtsyListingId", () => {
  it("accepts raw numeric ids", () => {
    assert.equal(extractEtsyListingId("4529408131"), "4529408131");
  });

  it("extracts the id from listing URLs", () => {
    assert.equal(
      extractEtsyListingId(
        "https://www.etsy.com/listing/4529408131/adopted-and-loved-rescue-dog",
      ),
      "4529408131",
    );
  });

  it("returns null for non-listing values", () => {
    assert.equal(extractEtsyListingId("https://printify.com/app/x"), null);
    assert.equal(extractEtsyListingId(""), null);
    assert.equal(extractEtsyListingId(null), null);
  });
});

describe("buildShareSaveUrl", () => {
  it("builds a listing link when the id is known", () => {
    delete process.env.ETSY_SHARE_SAVE_URL;
    assert.equal(
      buildShareSaveUrl({ etsyListingId: "4529408131" }),
      "https://octaneajax.etsy.com/listing/4529408131",
    );
  });

  it("derives the id from a stored listing URL", () => {
    delete process.env.ETSY_SHARE_SAVE_URL;
    assert.equal(
      buildShareSaveUrl({
        listingUrl: "https://www.etsy.com/listing/123456789/some-slug?ref=x",
      }),
      "https://octaneajax.etsy.com/listing/123456789",
    );
  });

  it("falls back to the shop link when no id is derivable", () => {
    delete process.env.ETSY_SHARE_SAVE_URL;
    assert.equal(buildShareSaveUrl(), "https://octaneajax.etsy.com");
    assert.equal(
      buildShareSaveUrl({ etsyListingId: null, listingUrl: null }),
      "https://octaneajax.etsy.com",
    );
  });
});

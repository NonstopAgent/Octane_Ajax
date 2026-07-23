import "server-only";

/**
 * Vision QA — the review gate's EYES.
 *
 * Until 2026-07-15 nothing in the pipeline ever LOOKED at the finished
 * product: Sage reviewed text and the flat artwork, approved a poster whose
 * art didn't fill the print area, and the poster shipped to Etsy and social.
 * The first vision check in the whole system was the operator's own eyeballs.
 *
 * This module puts a cheap multimodal check on the REAL Printify mockup —
 * the image buyers actually see — before anything is approved for publish.
 *
 * Failure policy: a model verdict of "fail" BLOCKS approval. A transport
 * error (API down, bad key) fails OPEN with `checked:false` so a vendor
 * outage can't freeze production — callers must log that loudly.
 */

export type VisionQaResult = {
  /** False when the check could not run (no key / transport error). */
  checked: boolean;
  pass: boolean;
  issues: string[];
  model?: string;
};

const PROMPT = `You are a strict print-on-demand quality inspector. Look at this product mockup image and answer in JSON only.

IMPORTANT product-type context: on MUGS and APPAREL (shirts, sweatshirts), the design is a centered graphic that occupies roughly 30-60% of the product face with clean product-colored margins around it — that is CORRECT professional placement, NOT a fill defect. On BANDANAS the printed panel is a triangle or wide strip that is naturally a SMALL part of the product photo — judge the design against the PRINTED PANEL only, never against the whole image; a design covering roughly 25-60% of the panel is CORRECT. Only POSTERS and ART PRINTS are full-bleed products where the artwork must fill the printed sheet edge to edge.

Check for these defects:
1. FILL: for posters/art prints only — artwork floating small on the sheet with unintended blank bands is a FAIL. For mugs/apparel, do NOT fail for normal centered-graphic margins; fail only if the design is tiny (under ~20% of the face), dramatically off-center, or wrapped so it faces away from the camera. For bandanas there is NO minimum-size or centering requirement: product photos show the bandana FOLDED or TIED, which naturally hides parts of the panel and shifts the visible design — that is the product's real geometry, not a defect. Fail a bandana ONLY if the visible text is unreadable or the design is obviously missing from the panel.
2. CROP: is any text or key design element cut off at an edge of the PRINTED DESIGN? (On bandanas, design partially hidden by a FOLD or knot is NOT a crop defect.)
3. TEXT: is all text in the design legible (not garbled, warped, or misspelled)?
4. MATCH: does the product in the image match this listing title: "{TITLE}"? Fail ONLY for a genuinely different product (e.g. a mug mockup for an apparel listing). Posters, art prints, and framed prints are the SAME product family — never fail one for another.
5. QUALITY: any obvious rendering artifacts, distortion, or unfinished-looking areas?

Respond with JSON exactly: {"pass": true|false, "issues": ["short description of each failed check, empty if pass"]}`;

const ARTWORK_PROMPT = `You are a print-on-demand quality inspector looking at FLAT ARTWORK that will be printed on a product (not a product photo — margins and transparent backgrounds are expected and fine).

IMPORTANT context on personalized products: when the listing title says "Custom", "Personalized", "Name", or "Date", the artwork correctly shows ONE sample pet name (like "Buddy" or "Luna") and/or a sample date (like "EST. AUGUST 12, 2021") as placeholders — those samples ARE the personalization demo. NEVER fail artwork for showing a specific sample name or date, and NEVER require literal words like "Custom Name" or "Gotcha Date" to appear. Likewise, showing a dog when the title says "pet", or a dog AND cat together on a general pet product, is CORRECT — only a clearly WRONG or unrelated subject fails.

Check ONLY these:
1. SUBJECT: is the artwork clearly UNRELATED to this listing title: "{TITLE}"? (e.g. a car for a dog product, a birthday theme for a memorial). Reasonable interpretations of the theme PASS.
2. TEXT: every word in the artwork must be correctly spelled, real English, and legible. Garbled, invented, or misspelled words are a FAIL.
3. QUALITY: obvious rendering artifacts, mangled anatomy, or unfinished areas are a FAIL. Also FAIL work a buyer would call amateurish: cluttered composition with no focal point, harsh clashing colors, or a generic-clipart look. (A clean, simple design with empty space is GOOD — simplicity is not a defect.)

Respond with JSON exactly: {"pass": true|false, "issues": ["short description of each failure, empty if pass"]}`;

/**
 * Gate the GENERATED ARTWORK before any money is spent downstream (Printify
 * upload, product creation, mockup renders, Sage review cycles). Added
 * 2026-07-20 after two mismatched designs burned full pipeline runs and the
 * operator asked to stop the waste at the source.
 */
export async function visionCheckArtwork(input: {
  artUrl: string;
  productTitle: string;
}): Promise<VisionQaResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return {
      checked: false,
      pass: true,
      issues: ["OPENAI_API_KEY not set — artwork QA skipped"],
    };
  }
  const model = process.env.VISION_QA_MODEL?.trim() || "gpt-4o-mini";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: ARTWORK_PROMPT.replace(
                  "{TITLE}",
                  input.productTitle.slice(0, 140),
                ),
              },
              { type: "image_url", image_url: { url: input.artUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        checked: false,
        pass: true,
        issues: [`vision API error: ${json.error?.message ?? res.status}`],
        model,
      };
    }
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { pass?: boolean; issues?: string[] };
    return {
      checked: true,
      pass: parsed.pass === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((i) => String(i)).slice(0, 6)
        : [],
      model,
    };
  } catch (err) {
    return {
      checked: false,
      pass: true,
      issues: [
        `artwork check failed to run: ${err instanceof Error ? err.message : "unknown"}`,
      ],
      model,
    };
  }
}

const COMPARE_PROMPT = `You are a strict print-on-demand quality inspector comparing two images of the SAME product. Image 1 is the authoritative product mockup. Image 2 is an AI-generated lifestyle scene of that product.

Check ONLY the product's printed design in image 2 against image 1:
1. TEXT: every word must match image 1 letter-for-letter and be legible. Garbled, warped, misspelled, blurred, or invented text is a FAIL.
2. ARTWORK: same artwork, same colors, same composition. A redrawn/altered design is a FAIL.

Respond with JSON exactly: {"match": true|false, "issues": ["short description, empty if match"]}`;

/**
 * Compare the printed design in a generated lifestyle scene against the real
 * mockup. The scene generator REDRAWS the product — on 2026-07-17 the
 * operator caught listing videos where the shirt's text was garbled
 * ("Cooper Chose Me" became invented words). A scene that fails this check
 * must never become a video source; callers fall back to the real mockup.
 */
export async function visionCompareSceneToMockup(input: {
  mockupUrl: string;
  sceneUrl: string;
}): Promise<VisionQaResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return {
      checked: false,
      pass: true,
      issues: ["OPENAI_API_KEY not set — scene QA skipped"],
    };
  }
  const model = process.env.VISION_QA_MODEL?.trim() || "gpt-4o-mini";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: COMPARE_PROMPT },
              { type: "image_url", image_url: { url: input.mockupUrl } },
              { type: "image_url", image_url: { url: input.sceneUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        checked: false,
        pass: true,
        issues: [`vision API error: ${json.error?.message ?? res.status}`],
        model,
      };
    }
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { match?: boolean; issues?: string[] };
    return {
      checked: true,
      pass: parsed.match === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((i) => String(i)).slice(0, 6)
        : [],
      model,
    };
  } catch (err) {
    return {
      checked: false,
      pass: true,
      issues: [
        `scene compare failed to run: ${err instanceof Error ? err.message : "unknown"}`,
      ],
      model,
    };
  }
}

/**
 * Bandana mockups defeated the general FILL/CROP rules across ~10 runs
 * (2026-07-22): product photos show the bandana FOLDED or TIED, so the
 * model kept inventing "cut off" / "too small" / "off-center" defects from
 * the fold geometry — even when told explicitly not to. Print placement is
 * now guaranteed by deterministic contain-fit math (tightest fit across all
 * variant panels), so the vision gate for bandanas checks only what vision
 * is reliable at: is it the right PRODUCT, and is visible text real English.
 * This still blocks the catastrophic failures (a framed poster shipped as a
 * bandana photo; garbled text) without the fold-hallucination loop.
 */
const BANDANA_PROMPT = `You are inspecting a product photo for a CLIP-ON PET BANDANA listing titled "{TITLE}". Bandana product photos show the bandana folded, tied, or worn — parts of the printed panel are NATURALLY hidden and the design may sit anywhere in frame. None of that is a defect. Answer in JSON only.

Check ONLY these two things:
1. PRODUCT: the photo must show a pet bandana or its printed panel. A completely different product (a mug, a framed picture, a shirt) is a FAIL.
2. TEXT: any VISIBLE design text must be real, correctly spelled English. Text partially hidden by a fold is FINE — only garbled, invented, or misspelled visible text is a FAIL.

Respond with JSON exactly: {"pass": true|false, "issues": ["short description of each failure, empty if pass"]}`;

export async function visionCheckProductMockup(input: {
  mockupUrl: string;
  productTitle: string;
}): Promise<VisionQaResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return {
      checked: false,
      pass: true,
      issues: ["OPENAI_API_KEY not set — vision QA skipped"],
    };
  }
  const model = process.env.VISION_QA_MODEL?.trim() || "gpt-4o-mini";
  const promptTemplate = /\bbandanas?\b/i.test(input.productTitle)
    ? BANDANA_PROMPT
    : PROMPT;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: promptTemplate.replace(
                  "{TITLE}",
                  input.productTitle.slice(0, 140),
                ),
              },
              { type: "image_url", image_url: { url: input.mockupUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        checked: false,
        pass: true,
        issues: [`vision API error: ${json.error?.message ?? res.status}`],
        model,
      };
    }
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { pass?: boolean; issues?: string[] };
    return {
      checked: true,
      pass: parsed.pass === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((i) => String(i)).slice(0, 6)
        : [],
      model,
    };
  } catch (err) {
    return {
      checked: false,
      pass: true,
      issues: [
        `vision check failed to run: ${err instanceof Error ? err.message : "unknown"}`,
      ],
      model,
    };
  }
}

/**
 * Etsy listing attributes (taxonomy properties + materials) via Open API v3.
 *
 * Standalone, additive helpers so the pipeline / backfill can set attributes on
 * a listing WITHOUT the Shop Manager web editor (which freezes rendering the
 * Materials option list). Server-side only. Mirrors the auth pattern in
 * etsy.ts / etsy-auth.ts:
 *   x-api-key = "<ETSY_CLIENT_ID>:<ETSY_CLIENT_SECRET>", Authorization: Bearer <token>.
 */

const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";

export class EtsyAttributesError extends Error {
  readonly code = "ETSY_ATTRIBUTES_ERROR" as const;
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EtsyAttributesError";
  }
}

function apiKeyHeader(): string {
  const clientId = process.env.ETSY_CLIENT_ID?.trim();
  if (!clientId) throw new EtsyAttributesError("ETSY_CLIENT_ID is not configured.");
  const secret = process.env.ETSY_CLIENT_SECRET?.trim();
  return secret ? `${clientId}:${secret}` : clientId;
}

function authHeaders(accessToken: string): HeadersInit {
  return { "x-api-key": apiKeyHeader(), Authorization: `Bearer ${accessToken}` };
}

async function parseJson<T extends Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  let body = {} as T & { error?: string };
  if (text) {
    try {
      body = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new EtsyAttributesError(
        `Etsy returned non-JSON (${res.status}).`,
        res.status,
      );
    }
  }
  if (!res.ok) {
    throw new EtsyAttributesError(
      (body.error as string | undefined) ??
        `Etsy API error (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }
  return body;
}

export type EtsyTaxonomyProperty = {
  property_id: number;
  property_name: string;
  scales?: { scale_id: number; scale_name: string }[];
  possible_values?: { value_id: number; name: string }[];
};

export type ListingSummary = { listingId: string; title: string; state: string };

export type DesiredProperty = {
  /** property_name candidates; first taxonomy match wins. */
  names: string[];
  /** desired value name, or a numeric string for scaled properties. */
  value: string;
  /** scaled numeric property (e.g. Capacity). */
  numeric?: boolean;
  /** preferred scale names for numeric properties. */
  scaleNames?: string[];
};

export type DesiredAttributes = {
  properties: DesiredProperty[];
  materials?: string[];
};

/** Chooses attributes from a product's descriptive hints (title / type words). */
export function desiredAttributesFor(hints: string[]): DesiredAttributes {
  const h = hints.join(" ").toLowerCase();
  if (/\bmugs?\b|coffee cup|ceramic cup/.test(h)) {
    return {
      properties: [
        { names: ["Graphic", "Theme"], value: "Animal" },
        {
          names: ["Capacity"],
          value: "11",
          numeric: true,
          scaleNames: ["Fluid ounces", "Ounces"],
        },
      ],
      materials: ["Ceramic"],
    };
  }
  if (/poster|art print|wall art|\bprint\b|wall d[eé]cor/.test(h)) {
    return {
      properties: [
        { names: ["Orientation"], value: "Vertical" },
        { names: ["Primary color"], value: "Beige" },
        { names: ["Secondary color"], value: "Green" },
        { names: ["Subject", "Graphic", "Theme"], value: "Animal" },
        { names: ["Room"], value: "Living room" },
        { names: ["Frame", "Frame type", "Framing"], value: "Unframed" },
      ],
      materials: ["Paper"],
    };
  }
  if (/shirt|tee|t-shirt|sweatshirt|hoodie|apparel|tote|bag|pillow|case/.test(h)) {
    return { properties: [{ names: ["Graphic", "Theme"], value: "Animal" }] };
  }
  return { properties: [{ names: ["Graphic", "Theme"], value: "Animal" }] };
}

export async function getTaxonomyProperties(
  taxonomyId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<EtsyTaxonomyProperty[]> {
  const res = await fetchImpl(
    `${ETSY_API_BASE}/seller-taxonomy/nodes/${taxonomyId}/properties`,
    { headers: { "x-api-key": apiKeyHeader(), Accept: "application/json" } },
  );
  const parsed = await parseJson<{ results?: EtsyTaxonomyProperty[] }>(res);
  return parsed.results ?? [];
}

/** Reads a listing's taxonomy_id + title (title feeds product-type inference). */
export async function getListingMeta(
  listingId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ taxonomyId: number | null; title: string }> {
  const res = await fetchImpl(`${ETSY_API_BASE}/listings/${listingId}`, {
    headers: authHeaders(accessToken),
  });
  const parsed = await parseJson<{ taxonomy_id?: number; title?: string }>(res);
  return {
    taxonomyId: parsed.taxonomy_id ?? null,
    title: (parsed.title ?? "").trim(),
  };
}

export async function setListingProperty(
  shopId: string,
  listingId: string,
  propertyId: number,
  accessToken: string,
  opts: { valueIds?: number[]; values?: string[]; scaleId?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = new URLSearchParams();
  for (const v of opts.valueIds ?? []) body.append("value_ids[]", String(v));
  for (const v of opts.values ?? []) body.append("values[]", v);
  if (opts.scaleId != null) body.set("scale_id", String(opts.scaleId));
  const res = await fetchImpl(
    `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/properties/${propertyId}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  await parseJson(res);
}

/** Sets the listing's free-text materials (Etsy `materials` field, not a property). */
export async function setListingMaterials(
  shopId: string,
  listingId: string,
  accessToken: string,
  materials: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const clean = materials
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 13);
  if (!clean.length) return;
  const body = new URLSearchParams();
  for (const m of clean) body.append("materials[]", m);
  const res = await fetchImpl(
    `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );
  await parseJson(res);
}

function findProperty(
  props: EtsyTaxonomyProperty[],
  names: string[],
): EtsyTaxonomyProperty | undefined {
  const lc = names.map((n) => n.toLowerCase());
  return (
    props.find((p) => typeof p.property_name === "string" && lc.includes(p.property_name.toLowerCase())) ??
    props.find((p) => typeof p.property_name === "string" && lc.some((n) => p.property_name.toLowerCase().includes(n)))
  );
}

export type ApplyResult = {
  taxonomyId: number | null;
  set: string[];
  skipped: string[];
  available?: string[];
};

/**
 * Resolves the listing's taxonomy, then sets each desired attribute the category
 * actually offers. Per-attribute failures are collected, never thrown, so one
 * bad property doesn't abort the rest. Idempotent (re-setting is harmless).
 */
export async function applyListingAttributes(
  shopId: string,
  listingId: string,
  accessToken: string,
  hints: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<ApplyResult> {
  const set: string[] = [];
  const skipped: string[] = [];

  const meta = await getListingMeta(listingId, accessToken, fetchImpl);
  if (meta.taxonomyId == null) {
    skipped.push("<no taxonomy_id on listing>");
    return { taxonomyId: null, set, skipped };
  }

  const effectiveHints = hints.length ? hints : meta.title ? [meta.title] : [];
  const desired = desiredAttributesFor(effectiveHints);
  const props = await getTaxonomyProperties(meta.taxonomyId, fetchImpl);
  const available = props
    .map((p) => p.property_name)
    .filter((n): n is string => typeof n === "string");

  for (const d of desired.properties) {
    const prop = findProperty(props, d.names);
    if (!prop) {
      skipped.push(`${d.names[0]} (not offered)`);
      continue;
    }
    try {
      if (d.numeric) {
        const scales = (prop.scales ?? []).filter(
          (s) => typeof s.scale_name === "string",
        );
        const scale =
          scales.find((s) =>
            (d.scaleNames ?? []).some((sn) =>
              s.scale_name.toLowerCase().includes(sn.toLowerCase()),
            ),
          ) ?? scales[0];
        if (!scale) {
          skipped.push(`${prop.property_name} (no scale)`);
          continue;
        }
        await setListingProperty(
          shopId,
          listingId,
          prop.property_id,
          accessToken,
          { values: [d.value], scaleId: scale.scale_id },
          fetchImpl,
        );
        set.push(`${prop.property_name}=${d.value} ${scale.scale_name}`);
      } else {
        const values = (prop.possible_values ?? []).filter(
          (v) => typeof v.name === "string",
        );
        const pv =
          values.find((v) => v.name.toLowerCase() === d.value.toLowerCase()) ??
          values.find((v) =>
            v.name.toLowerCase().includes(d.value.toLowerCase()),
          );
        if (!pv) {
          skipped.push(`${prop.property_name} (no value "${d.value}")`);
          continue;
        }
        await setListingProperty(
          shopId,
          listingId,
          prop.property_id,
          accessToken,
          { valueIds: [pv.value_id], values: [pv.name] },
          fetchImpl,
        );
        set.push(`${prop.property_name}=${pv.name}`);
      }
    } catch (err) {
      skipped.push(
        `${prop.property_name} (error: ${err instanceof Error ? err.message : "unknown"})`,
      );
    }
  }

  if (desired.materials?.length) {
    try {
      await setListingMaterials(
        shopId,
        listingId,
        accessToken,
        desired.materials,
        fetchImpl,
      );
      set.push(`materials=${desired.materials.join("/")}`);
    } catch (err) {
      skipped.push(
        `materials (error: ${err instanceof Error ? err.message : "unknown"})`,
      );
    }
  }

  return { taxonomyId: meta.taxonomyId, set, skipped, available };
}

/** Lists the shop's active + draft listings (id, title, state) for reconcile. */
export async function listShopListingSummaries(
  shopId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListingSummary[]> {
  const out: ListingSummary[] = [];
  for (const state of ["active", "draft"]) {
    try {
      const res = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings?state=${state}&limit=100`,
        { headers: authHeaders(accessToken) },
      );
      const parsed = await parseJson<{
        results?: { listing_id?: number; title?: string; state?: string }[];
      }>(res);
      for (const r of parsed.results ?? []) {
        if (r.listing_id == null) continue;
        out.push({
          listingId: String(r.listing_id),
          title: (r.title ?? "").trim(),
          state: (r.state ?? state).trim(),
        });
      }
    } catch {
      /* skip a state that errors (e.g. permissions) */
    }
  }
  return out;
}

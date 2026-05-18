import { NextResponse } from "next/server";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import {
  insertGumroadEvent,
  publishListingToGumroad,
  type GumroadPublishDependencies,
} from "@/lib/review/gumroad-on-approve";
import { createClient } from "@/lib/supabase/server";
import type {
  ProductGeneration as DbGeneration,
  ProductListing as DbListing,
} from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

type RouteContext = { params: Promise<{ id: string }> };

export type PublishGumroadRouteDependencies = {
  createSupabaseClient?: typeof createClient;
  gumroad?: GumroadPublishDependencies;
};

async function logFailure(
  supabase: Supabase,
  userId: string,
  listingId: string,
  message: string,
) {
  await insertGumroadEvent(
    supabase,
    userId,
    "gumroad_publish_failed",
    message,
    { listingId },
  );
}

async function loadOwnedListing(
  supabase: Supabase,
  userId: string,
  listingId: string,
): Promise<DbListing | null> {
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("*")
    .eq("id", listingId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data as DbListing;
}

async function loadReadyGeneration(
  supabase: Supabase,
  userId: string,
  listingId: string,
): Promise<DbGeneration | null> {
  const { data, error } = await supabase
    .from(TABLES.GENERATIONS)
    .select("*")
    .eq("user_id", userId)
    .eq("product_listing_id", listingId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (
    ((data ?? []) as DbGeneration[]).find(
      (row) =>
        row.generation_status === "ready" &&
        Boolean(row.pdf_storage_path?.trim()),
    ) ?? null
  );
}

export async function handlePublishGumroadRequest(
  context: RouteContext,
  deps: PublishGumroadRouteDependencies = {},
) {
  const { id: listingId } = await context.params;
  const supabase = await (deps.createSupabaseClient ?? createClient)();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const row = await loadOwnedListing(supabase, user.id, listingId);
  if (!row) {
    return NextResponse.json(
      {
        ok: false,
        status: "not_found",
        message: "Listing not found.",
      },
      { status: 404 },
    );
  }

  if (row.status !== "approved" && row.status !== "published") {
    const message =
      "Only approved or published listings can be published to Gumroad.";
    await logFailure(supabase, user.id, listingId, message);
    return NextResponse.json(
      { ok: false, status: "blocked", message },
      { status: 409 },
    );
  }

  const existingUrl = row.gumroad_url?.trim();
  if (existingUrl) {
    return NextResponse.json({
      ok: true,
      status: "already_published",
      message: "Listing already has a Gumroad URL.",
      url: existingUrl,
      productId: row.gumroad_product_id,
    });
  }

  const generation = await loadReadyGeneration(supabase, user.id, listingId);
  if (!generation) {
    const message =
      "Gumroad publish blocked: listing needs a ready product PDF first.";
    await logFailure(supabase, user.id, listingId, message);
    return NextResponse.json(
      { ok: false, status: "missing_pdf", message },
      { status: 409 },
    );
  }

  const result = await publishListingToGumroad(
    {
      supabase,
      userId: user.id,
      listingId,
      listing: mapListingFromDb(row),
      generation: mapGenerationFromDb(generation),
    },
    {
      failureMessagePrefix: "Gumroad publish failed",
      dependencies: deps.gumroad,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: result.status,
        message: result.message,
      },
      { status: result.statusCode },
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    message: result.message,
    url: result.gumroadUrl,
    productId: result.gumroadProductId,
  });
}

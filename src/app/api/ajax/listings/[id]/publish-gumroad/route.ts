import { NextResponse } from "next/server";
import { handlePublishGumroadRequest } from "@/lib/store/publish-gumroad-route";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/ajax/listings/[id]/publish-gumroad — retry Gumroad publish. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    return await handlePublishGumroadRequest(context);
  } catch (err) {
    console.error("[listings/publish-gumroad]", err);
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "Failed to publish listing to Gumroad.",
      },
      { status: 500 },
    );
  }
}

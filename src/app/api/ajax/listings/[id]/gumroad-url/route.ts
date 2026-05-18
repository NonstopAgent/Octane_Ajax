import { handleGumroadUrlPatch } from "@/lib/store/gumroad-url-route";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/ajax/listings/[id]/gumroad-url — save manual checkout URL. */
export async function PATCH(request: Request, context: RouteContext) {
  return handleGumroadUrlPatch(request, context);
}

/**
 * GET /go/[slug] — tracked outbound redirect for guide links.
 * Looks up the affiliate link, records the click (best-effort), and 302s to
 * the (already network-decorated) destination. Serves both affiliate-network
 * links today and creator/shop-affiliate links in phase 2.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const supabase = createServiceClient();
    const { data: link } = await supabase
      .from(TABLES.AFFILIATE_LINKS)
      .select("id, destination_url")
      .eq("slug", slug)
      .maybeSingle();

    if (!link?.destination_url) {
      return NextResponse.redirect(new URL("/guides", req.url), 302);
    }

    // Best-effort click log — never block the redirect on it.
    void supabase
      .from(TABLES.AFFILIATE_CLICKS)
      .insert({
        link_id: link.id,
        referrer: req.headers.get("referer")?.slice(0, 300) ?? null,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      })
      .then(() => undefined);

    const res = NextResponse.redirect(link.destination_url, 302);
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/guides", req.url), 302);
  }
}

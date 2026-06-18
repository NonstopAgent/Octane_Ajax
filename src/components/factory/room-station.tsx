"use client";

import { useCallback, useEffect, useState } from "react";
import { ORDER_ROOM_SLUG } from "@/lib/ajax/pod/order-types";
import type { OrderQueueRow, OrderQueueStatus } from "@/lib/ajax/pod/order-types";
import { getRoomDisplayName } from "@/lib/ajax/constants";
import { useAjaxRealtime } from "@/hooks/useAjaxRealtime";
import { createClient } from "@/lib/supabase/client";
import { TABLES } from "@/lib/supabase/schema";
import type { OrderQueue } from "@/lib/supabase/database.types";

type RoomStationProps = {
  enabled: boolean;
  initialOrders?: OrderQueueRow[];
};

const STATUS_LABELS: Record<OrderQueueStatus, string> = {
  pending_personalization: "Queued",
  processing_artwork: "Rendering",
  fulfillment_ready: "Ready",
  production_submitted: "Submitted",
  failed: "Failed",
};

function statusBadgeClass(status: OrderQueueStatus): string {
  switch (status) {
    case "processing_artwork":
      return "order-status-badge order-status-badge--amber-pulse";
    case "pending_personalization":
      return "order-status-badge order-status-badge--amber";
    case "fulfillment_ready":
      return "order-status-badge order-status-badge--chrome";
    case "production_submitted":
      return "order-status-badge order-status-badge--green";
    case "failed":
      return "order-status-badge order-status-badge--red";
    default:
      return "order-status-badge";
  }
}

function truncatePrompt(prompt: string, max = 120): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function mapOrderRow(row: OrderQueue): OrderQueueRow {
  return {
    id: row.id,
    user_id: row.user_id,
    etsy_order_id: row.etsy_order_id,
    listing_id: row.listing_id,
    customer_photo_url: row.customer_photo_url,
    style_prompt: row.style_prompt,
    status: row.status as OrderQueueStatus,
    printify_product_id: row.printify_product_id,
    printify_upload_id: row.printify_upload_id,
    artwork_url: row.artwork_url,
    error_message: row.error_message,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Room 2 — Personalization Bay: live order_queue workstation. */
export function RoomStation({ enabled, initialOrders = [] }: RoomStationProps) {
  const [orders, setOrders] = useState<OrderQueueRow[]>(initialOrders);
  const [loading, setLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from(TABLES.ORDER_QUEUE)
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(16);

      if (error) {
        console.error("[RoomStation] fetch failed", error);
        return;
      }

      setOrders((data ?? []).map(mapOrderRow));
    } finally {
      setLoading(false);
    }
  }, []);

  useAjaxRealtime({
    enabled,
    onRefresh: loadOrders,
    debounceMs: 350,
  });

  useEffect(() => {
    if (enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-enable
      void loadOrders();
    }
  }, [enabled, loadOrders]);

  const activeCount = orders.filter(
    (o) =>
      o.status !== "production_submitted" && o.status !== "failed",
  ).length;

  return (
    <section className="sweatshop-bay flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <header className="border-b border-zinc-800 bg-gradient-to-r from-zinc-900 to-zinc-950 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Room 2
            </p>
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-100">
              Personalization Bay
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-amber-500/80">
              {getRoomDisplayName(ORDER_ROOM_SLUG)} · order_queue
            </p>
          </div>
          <div className="text-right font-mono text-[10px] text-zinc-500">
            <p>
              <span className="text-amber-400">{activeCount}</span> active
            </p>
            <p>{orders.length} total</p>
          </div>
        </div>
      </header>

      <div className="min-h-[18rem] flex-1 space-y-2 overflow-y-auto p-3">
        {loading && orders.length === 0 && (
          <p className="font-mono text-xs text-zinc-500">Scanning queue…</p>
        )}

        {!loading && orders.length === 0 && (
          <div className="order-card order-card--empty flex min-h-[10rem] flex-col items-center justify-center p-6 text-center">
            <span className="font-mono text-2xl text-zinc-700" aria-hidden>
              ◇
            </span>
            <p className="mt-2 font-mono text-xs text-zinc-500">
              Bay idle — no orders in queue
            </p>
            <p className="mt-1 font-mono text-[10px] text-zinc-600">
              Etsy webhook → pending_personalization
            </p>
          </div>
        )}

        {orders.map((order) => (
          <article
            key={order.id}
            className={`order-card ${order.status === "processing_artwork" ? "order-card--active" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Etsy order
                </p>
                <p className="font-mono text-sm font-semibold text-zinc-100">
                  #{order.etsy_order_id}
                </p>
              </div>
              <span className={statusBadgeClass(order.status)}>
                {STATUS_LABELS[order.status]}
              </span>
            </div>

            <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              Style prompt
            </p>
            <p className="mt-1 font-mono text-xs leading-relaxed text-zinc-300">
              {truncatePrompt(order.style_prompt)}
            </p>

            {order.error_message && (
              <p className="mt-2 font-mono text-[10px] text-red-400/90">
                ERR :: {order.error_message}
              </p>
            )}

            <footer className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-800/80 pt-2 font-mono text-[10px] text-zinc-600">
              <span>
                upd{" "}
                {new Date(order.updated_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </span>
              {order.artwork_url && (
                <span className="text-emerald-500/80">artwork locked</span>
              )}
              {order.printify_product_id && (
                <span className="text-zinc-500">
                  printify:{order.printify_product_id.slice(0, 8)}…
                </span>
              )}
            </footer>
          </article>
        ))}
      </div>

      <footer className="border-t border-zinc-800 bg-black/40 px-4 py-2">
        <p className="font-mono text-[10px] text-zinc-600">
          BAY.STATUS :: webhook → gpt-image-1 → printify → production
        </p>
      </footer>
    </section>
  );
}

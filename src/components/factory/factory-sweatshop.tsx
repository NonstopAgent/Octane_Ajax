"use client";

import Link from "next/link";
import { EventFeed } from "@/components/factory/event-feed";
import { RoomStation } from "@/components/factory/room-station";
import { CommandHeader } from "@/components/layout/command-header";
import type { FactoryEvent } from "@/lib/ajax/types";
import type { OrderQueueRow } from "@/lib/ajax/pod/order-types";

type FactorySweatshopProps = {
  isAuthenticated: boolean;
  configReady: boolean;
  initialEvents: FactoryEvent[];
  initialOrders: OrderQueueRow[];
};

export function FactorySweatshop({
  isAuthenticated,
  configReady,
  initialEvents,
  initialOrders,
}: FactorySweatshopProps) {
  const realtimeEnabled = configReady && isAuthenticated;

  if (!configReady) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl border-zinc-800 bg-zinc-900">
        <h1 className="font-mono text-xl font-bold text-zinc-100">
          Supabase not configured
        </h1>
        <p className="mt-2 font-mono text-sm text-zinc-500">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
          .env.local, then restart the dev server.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="factory-panel panel-glow-orange max-w-xl border-zinc-800 bg-zinc-900">
        <h1 className="font-mono text-xl font-bold text-zinc-100">
          Sign in required
        </h1>
        <p className="mt-2 font-mono text-sm text-zinc-500">
          Sign in to monitor the agent sweatshop floor. RLS scopes queue rows
          to your account.
        </p>
        <Link
          href="/login?next=/factory"
          className="mt-4 inline-flex font-mono text-sm font-semibold text-amber-400 hover:underline"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CommandHeader
        badge="Agent sweatshop"
        title="Factory control room"
        description={
          <>
            Obsidian chrome floor monitor — live{" "}
            <span className="font-mono text-amber-400/90">factory_events</span>{" "}
            ticker and Room 2 personalization queue.{" "}
            <Link
              href="/dashboard"
              className="font-mono text-emerald-400/90 hover:underline"
            >
              Pipeline deck →
            </Link>
          </>
        }
        sysline="SYS.AJAX.SWEATSHOP :: ROOM.02.PERSONALIZATION"
      />

      <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
        <div className="lg:col-span-2">
          <RoomStation enabled={realtimeEnabled} initialOrders={initialOrders} />
        </div>
        <div className="lg:col-span-3">
          <EventFeed enabled={realtimeEnabled} initialEvents={initialEvents} />
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-3 font-mono text-[10px] text-zinc-600">
        Vercel env: set ETSY webhook secrets, OPENAI_API_KEY, PRINTIFY_API_KEY
        in project settings before live order flow.
      </div>
    </div>
  );
}

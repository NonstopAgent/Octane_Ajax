"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAgentDisplayName,
  getRoomDisplayName,
} from "@/lib/ajax/constants";
import { getFactoryEventMessage } from "@/lib/ajax/helpers";
import type { FactoryEvent } from "@/lib/ajax/types";
import type { AgentSlug } from "@/lib/ajax/types";
import { useAjaxRealtime } from "@/hooks/useAjaxRealtime";
import { mapEventFromDb } from "@/lib/ajax/mappers";
import { createClient } from "@/lib/supabase/client";
import { TABLES } from "@/lib/supabase/schema";

const ORDER_EVENT_PREFIX = "order_";

type EventFeedProps = {
  enabled: boolean;
  initialEvents?: FactoryEvent[];
};

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function eventDotClass(eventType: string): string {
  if (eventType.includes("failed")) return "event-feed-dot event-feed-dot--red";
  if (
    eventType.includes("started") ||
    eventType.includes("processing") ||
    eventType === "order_webhook_received"
  ) {
    return "event-feed-dot event-feed-dot--amber";
  }
  if (
    eventType.includes("ready") ||
    eventType.includes("submitted") ||
    eventType.includes("completed") ||
    eventType.includes("approved")
  ) {
    return "event-feed-dot event-feed-dot--green";
  }
  if (eventType.startsWith(ORDER_EVENT_PREFIX)) {
    return "event-feed-dot event-feed-dot--amber";
  }
  return "event-feed-dot event-feed-dot--chrome";
}

export function EventFeed({ enabled, initialEvents = [] }: EventFeedProps) {
  const [events, setEvents] = useState<FactoryEvent[]>(initialEvents);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLUListElement>(null);
  const prevTopIdRef = useRef<string | null>(initialEvents[0]?.id ?? null);

  const loadEvents = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from(TABLES.EVENTS)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) {
      console.error("[EventFeed] fetch failed", error);
      return;
    }

    const mapped = (data ?? []).map(mapEventFromDb);
    setEvents(mapped);

    const newTopId = mapped[0]?.id ?? null;
    if (newTopId && newTopId !== prevTopIdRef.current) {
      const newFresh = new Set<string>();
      for (const event of mapped) {
        if (event.id === prevTopIdRef.current) break;
        newFresh.add(event.id);
      }
      if (newFresh.size > 0) {
        setFreshIds(newFresh);
        window.setTimeout(() => setFreshIds(new Set()), 4000);
      }
      prevTopIdRef.current = newTopId;
    }
  }, []);

  const { status, isRefreshing } = useAjaxRealtime({
    enabled,
    onRefresh: loadEvents,
    debounceMs: 300,
  });

  useEffect(() => {
    if (enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-enable
      void loadEvents();
    }
  }, [enabled, loadEvents]);

  const topEventId = events[0]?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }, [events.length, topEventId]);

  return (
    <section className="machine-log sweatshop-log flex max-h-[32rem] flex-col border-zinc-800 bg-zinc-950">
      <header className="machine-log-header shrink-0 border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
              Agent sweatshop log
            </h2>
            <p className="font-mono text-[10px] text-zinc-500">
              SYS.TICKER :: factory_events · realtime
            </p>
          </div>
          <span
            className={`live-indicator text-[10px] ${status === "live" ? "live-indicator-on" : ""}`}
          >
            <span className="live-indicator-dot" aria-hidden />
            {status === "live"
              ? "LIVE"
              : status === "connecting"
                ? "SYNC"
                : status.toUpperCase()}
            {isRefreshing ? " ·" : ""}
          </span>
        </div>
      </header>

      <ul
        ref={scrollRef}
        className="machine-log-body min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-smooth p-1"
      >
        {events.length === 0 && (
          <li className="machine-log-line text-center font-mono text-zinc-500">
            [idle] Awaiting factory_events — Etsy webhooks & personalization
            pipeline.
          </li>
        )}

        {events.map((event) => {
          const isFresh = freshIds.has(event.id);
          const isOrder = event.eventType.startsWith(ORDER_EVENT_PREFIX);

          return (
            <li
              key={event.id}
              className={`machine-log-line event-feed-row font-mono ${isFresh ? "event-feed-row--fresh" : ""} ${isOrder ? "event-feed-row--order" : ""}`}
            >
              <p className="flex items-start gap-2">
                <span
                  className={eventDotClass(event.eventType)}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="machine-log-ts text-emerald-400/90">
                    [{formatTime(event.createdAt)}]
                  </span>{" "}
                  <span className="machine-log-tag text-amber-400/90">
                    {event.eventType.replace(/_/g, ".")}
                  </span>
                </span>
              </p>
              <p className="mt-1 pl-4 text-zinc-200">
                {getFactoryEventMessage(event)}
              </p>
              <p className="mt-0.5 pl-4 text-[10px] text-zinc-500">
                {event.agentSlug
                  ? getAgentDisplayName(event.agentSlug as AgentSlug)
                  : "SYS"}
                {event.room ? ` @ ${getRoomDisplayName(event.room)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

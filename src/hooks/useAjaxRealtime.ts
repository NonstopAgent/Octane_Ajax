"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TABLES } from "@/lib/supabase/schema";

export type AjaxRealtimeStatus =
  | "idle"
  | "connecting"
  | "live"
  | "error"
  | "offline";

type UseAjaxRealtimeOptions = {
  /** When false, no channel is opened (e.g. unsigned-in or missing env). */
  enabled: boolean;
  /** Called after a debounced Realtime event or manual refresh. */
  onRefresh: () => void | Promise<void>;
  /** Debounce window for coalescing burst updates (ms). */
  debounceMs?: number;
};

type UseAjaxRealtimeResult = {
  status: AjaxRealtimeStatus;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  /** Manual fallback refresh (same path as Realtime-triggered refresh). */
  refresh: () => Promise<void>;
};

const USER_SCOPED_TABLES = [
  TABLES.EVENTS,
  TABLES.ORDER_QUEUE,
  TABLES.TIKTOK_QUEUE,
  TABLES.REVIEW_QUEUE,
  TABLES.LISTINGS,
  TABLES.CONTENT_JOBS,
] as const;

/**
 * Subscribes to Supabase Realtime postgres changes for the factory dashboard.
 * Uses the browser anon client — RLS filters rows per authenticated user.
 */
export function useAjaxRealtime({
  enabled,
  onRefresh,
  debounceMs = 450,
}: UseAjaxRealtimeOptions): UseAjaxRealtimeResult {
  const [connectionStatus, setConnectionStatus] =
    useState<AjaxRealtimeStatus>("idle");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const status: AjaxRealtimeStatus = enabled ? connectionStatus : "offline";

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshRef.current();
      if (isMountedRef.current) {
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error("[useAjaxRealtime] refresh failed", err);
      if (isMountedRef.current) {
        setConnectionStatus("error");
      }
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refresh();
    }, debounceMs);
  }, [debounceMs, refresh]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch (err) {
      console.error("[useAjaxRealtime] client init failed", err);
      queueMicrotask(() => setConnectionStatus("error"));
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const setup = async () => {
      setConnectionStatus("connecting");

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (authError || !user) {
        setConnectionStatus("offline");
        return;
      }

      const userId = user.id;
      channel = supabase.channel(`ajax-factory:${userId}`);

      for (const table of USER_SCOPED_TABLES) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `user_id=eq.${userId}`,
          },
          () => scheduleRefresh(),
        );
      }

      // Shared system agents — RLS allows read/update for authenticated demo users.
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: TABLES.AGENTS,
        },
        () => scheduleRefresh(),
      );

      channel.subscribe((subscribeStatus, err) => {
        if (cancelled) return;

        if (subscribeStatus === "SUBSCRIBED") {
          setConnectionStatus("live");
          return;
        }

        if (
          subscribeStatus === "CHANNEL_ERROR" ||
          subscribeStatus === "TIMED_OUT"
        ) {
          console.error("[useAjaxRealtime] channel error", err);
          setConnectionStatus("error");
        }
      });
    };

    void setup();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [enabled, scheduleRefresh]);

  return {
    status,
    lastUpdated,
    isRefreshing,
    refresh,
  };
}

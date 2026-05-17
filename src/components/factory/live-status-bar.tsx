"use client";

import type { AjaxRealtimeStatus } from "@/hooks/useAjaxRealtime";
import { Button } from "@/components/ui/button";

type LiveStatusBarProps = {
  status: AjaxRealtimeStatus;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const STATUS_LABEL: Record<AjaxRealtimeStatus, string> = {
  idle: "Connecting",
  connecting: "Connecting",
  live: "Live",
  error: "Reconnect",
  offline: "Offline",
};

export function LiveStatusBar({
  status,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: LiveStatusBarProps) {
  const isLive = status === "live";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className={`live-indicator ${isLive ? "live-indicator-on" : ""}`}
        title={
          isLive
            ? "Realtime connected — dashboard updates automatically"
            : STATUS_LABEL[status]
        }
      >
        <span className="live-indicator-dot" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-widest">
          {STATUS_LABEL[status]}
        </span>
      </div>

      {lastUpdated && (
        <span className="text-[10px] text-[var(--text-muted)]">
          Updated {lastUpdated.toLocaleTimeString()}
        </span>
      )}

      <Button
        variant="ghost"
        className="h-8 px-2 text-xs"
        disabled={isRefreshing}
        onClick={onRefresh}
      >
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}

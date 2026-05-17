"use client";

import type { FactoryMetrics } from "@/lib/factory/types";

const METRIC_ITEMS = [
  { key: "productIdeas" as const, label: "Ideas mined", accent: "blue" },
  { key: "pendingReviews" as const, label: "QC pending", accent: "orange" },
  { key: "scheduledContent" as const, label: "Content scheduled", accent: "blue" },
  {
    key: "publishedListings" as const,
    label: "Published",
    accent: "orange",
  },
];

export function MetricsStrip({ metrics }: { metrics: FactoryMetrics }) {
  return (
    <section aria-label="Command center metrics">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
        Telemetry strip
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRIC_ITEMS.map((item) => (
          <div
            key={item.key}
            className={`factory-metric command-metric ${item.accent === "orange" ? "factory-metric-orange" : ""}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {item.label}
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-[var(--foreground)]">
              {metrics[item.key]}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

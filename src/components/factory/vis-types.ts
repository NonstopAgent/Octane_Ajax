/**
 * Shared view-model types for the factory floor visualizations.
 *
 * Extracted from the retired 2D `factory-vis-map.tsx` (M14) — the SVG map is
 * gone, but the 3D floor, the sweatshop shell, and the /factory page all
 * exchange agents + metrics in this shape.
 */
import type { AgentStatus } from "@/lib/ajax/status";
import type { AgentSlug } from "@/lib/ajax/types";

export type VisAgent = {
  slug: AgentSlug;
  status: AgentStatus;
  currentRoom: string | null;
};

export type VisMetrics = {
  productIdeas: number;
  pendingReviews: number;
  scheduledContent: number;
  publishedListings: number;
};

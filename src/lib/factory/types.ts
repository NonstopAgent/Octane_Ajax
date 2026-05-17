import type { AjaxAgent, AjaxTask, FactoryEvent } from "@/lib/ajax/types";

export type FactoryMetrics = {
  productIdeas: number;
  pendingReviews: number;
  scheduledContent: number;
  publishedListings: number;
};

export type FactorySnapshot = {
  agents: AjaxAgent[];
  tasksById: Record<string, AjaxTask>;
  events: FactoryEvent[];
  metrics: FactoryMetrics;
};

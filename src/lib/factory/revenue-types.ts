import type { AjaxAgent, FactoryEvent } from "@/lib/ajax/types";
import type { PipelineFunnel } from "@/lib/factory/revenue-queries";

export type RevenueDashboardData = {
  agents: AjaxAgent[];
  funnel: PipelineFunnel;
  thisWeek: {
    productsGenerated: number;
    passedQualityGate: number;
    approved: number;
    liveOnEtsy: number;
  };
  recentEvents: FactoryEvent[];
};

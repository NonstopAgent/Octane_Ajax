import {
  AGENT_DISPLAY_NAMES,
  getAgentDisplayName,
  getRoomDisplayName,
} from "@/lib/ajax/constants";
import type { AgentSlug, FactoryEvent } from "@/lib/ajax/types";

const EVENT_TYPE_MESSAGES: Record<string, (event: FactoryEvent) => string> = {
  agent_started: (e) =>
    `${agentLabel(e.agentSlug)} started work in ${roomLabel(e.room)}.`,
  agent_completed: (e) =>
    `${agentLabel(e.agentSlug)} finished a task in ${roomLabel(e.room)}.`,
  idea_created: () => "Nova generated a new product idea.",
  listing_created: () => "Forge created a product listing.",
  review_requested: () => "Listing sent to the Review Gate — your turn.",
  review_approved: () =>
    "Listing approved. Pixel schedules demo content and publishes to the demo storefront.",
  review_rejected: () => "Listing rejected. Feedback saved for agents.",
  content_scheduled: () => "Pixel scheduled marketing content.",
  cycle_started: () => "Ajax cycle started. Factory online.",
  cycle_completed: () => "Ajax cycle completed.",
};

function agentLabel(slug: AgentSlug | string | null | undefined): string {
  if (!slug) return "An agent";
  return getAgentDisplayName(slug);
}

function roomLabel(room: string | null | undefined): string {
  if (!room) return "the factory";
  return getRoomDisplayName(room);
}

/**
 * User-facing message for a factory event.
 * Uses `event.message` when present; otherwise derives from `eventType`.
 */
export function getFactoryEventMessage(event: FactoryEvent): string {
  const trimmed = event.message?.trim();
  if (trimmed) return trimmed;

  const builder = EVENT_TYPE_MESSAGES[event.eventType];
  if (builder) return builder(event);

  const who = event.agentSlug
    ? AGENT_DISPLAY_NAMES[event.agentSlug as AgentSlug] ?? event.agentSlug
    : "Factory";

  return `${who}: ${event.eventType.replace(/_/g, " ")}`;
}

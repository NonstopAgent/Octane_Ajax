import type { AgentSlug } from "@/lib/ajax/types";

/** Canonical room slugs (match DB `current_room` / `factory_events.room`). */
export const ROOM_SLUGS = {
  RESEARCH_LAB: "research_lab",
  DESIGN_PRESS: "design_press",
  REVIEW_GATE: "review_gate",
  MEDIA_STUDIO: "media_studio",
  STOREFRONT: "storefront",
} as const;

import type { RoomSlug } from "@/lib/ajax/types";

export type { RoomSlug };

export const AGENT_SLUGS = {
  NOVA: "nova",
  FORGE: "forge",
  PIXEL: "pixel",
} as const satisfies Record<string, AgentSlug>;

/** Ordered factory pipeline — source of truth for floor map & routing. */
export const PIPELINE_STAGES = [
  {
    id: "nova",
    label: "Nova",
    room: "Research Lab",
    roomSlug: ROOM_SLUGS.RESEARCH_LAB,
    agentSlug: AGENT_SLUGS.NOVA,
    kind: "agent" as const,
  },
  {
    id: "forge",
    label: "Forge",
    room: "Design Press",
    roomSlug: ROOM_SLUGS.DESIGN_PRESS,
    agentSlug: AGENT_SLUGS.FORGE,
    kind: "agent" as const,
  },
  {
    id: "review",
    label: "Human Review",
    room: "Review Gate",
    roomSlug: ROOM_SLUGS.REVIEW_GATE,
    agentSlug: null,
    kind: "human" as const,
  },
  {
    id: "pixel",
    label: "Pixel",
    room: "Media Studio",
    roomSlug: ROOM_SLUGS.MEDIA_STUDIO,
    agentSlug: AGENT_SLUGS.PIXEL,
    kind: "agent" as const,
  },
  {
    id: "published",
    label: "Published",
    room: "Storefront",
    roomSlug: ROOM_SLUGS.STOREFRONT,
    agentSlug: null,
    kind: "output" as const,
  },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];

/** Quick lookup: agent slug → default room display name. */
export const AGENT_ROOM_BY_SLUG: Record<AgentSlug, string> = {
  nova: "Research Lab",
  forge: "Design Press",
  pixel: "Media Studio",
};

/** Quick lookup: agent slug → display name. */
export const AGENT_DISPLAY_NAMES: Record<AgentSlug, string> = {
  nova: "Nova",
  forge: "Forge",
  pixel: "Pixel",
};

export const AGENT_ROLES: Record<AgentSlug, string> = {
  nova: "Research Agent",
  forge: "Creation Agent",
  pixel: "Marketing Agent",
};

/** Room slug → display name. */
export const ROOM_DISPLAY_NAMES: Record<RoomSlug, string> = {
  research_lab: "Research Lab",
  design_press: "Design Press",
  review_gate: "Review Gate",
  media_studio: "Media Studio",
  storefront: "Storefront",
};

export function getAgentDisplayName(slug: AgentSlug | string): string {
  if (slug in AGENT_DISPLAY_NAMES) {
    return AGENT_DISPLAY_NAMES[slug as AgentSlug];
  }
  return slug;
}

export function getAgentRoom(slug: AgentSlug | string): string {
  if (slug in AGENT_ROOM_BY_SLUG) {
    return AGENT_ROOM_BY_SLUG[slug as AgentSlug];
  }
  return "Unknown";
}

export function getRoomDisplayName(roomSlug: RoomSlug | string): string {
  if (roomSlug in ROOM_DISPLAY_NAMES) {
    return ROOM_DISPLAY_NAMES[roomSlug as RoomSlug];
  }
  return roomSlug.replace(/_/g, " ");
}

export function getPipelineStageByRoomSlug(roomSlug: string) {
  return PIPELINE_STAGES.find((s) => s.roomSlug === roomSlug);
}

export function getPipelineStageByAgentSlug(slug: AgentSlug) {
  return PIPELINE_STAGES.find((s) => s.agentSlug === slug);
}

/** Live activity lines shown on the factory floor UI. */
export const AGENT_MICROCOPY: Record<AgentSlug, string> = {
  nova: "Scanning demand signals",
  forge: "Manufacturing listing assets",
  pixel: "Packaging content for distribution",
};

export const REVIEW_GATE_MICROCOPY = "Human quality checkpoint";

export function getAgentActivityLine(
  slug: AgentSlug,
  status: string,
): string {
  if (status === "working" || status === "thinking") {
    return AGENT_MICROCOPY[slug];
  }
  if (status === "waiting_review") {
    return REVIEW_GATE_MICROCOPY;
  }
  if (status === "error") {
    return "Fault — intervention required";
  }
  return "Standing by";
}

export function getStationMicrocopy(
  stageId: PipelineStageId,
  agents: { slug: string; status: string }[],
): string {
  if (stageId === "review") {
    return REVIEW_GATE_MICROCOPY;
  }
  if (stageId === "published") {
    return "Storefront output channel";
  }
  const active = agents.find(
    (a) => a.status === "working" || a.status === "thinking",
  );
  if (active && active.slug in AGENT_MICROCOPY) {
    return AGENT_MICROCOPY[active.slug as AgentSlug];
  }
  const agentSlug = PIPELINE_STAGES.find((s) => s.id === stageId)?.agentSlug;
  if (agentSlug) {
    return `${AGENT_DISPLAY_NAMES[agentSlug]} — idle`;
  }
  return "Station idle";
}

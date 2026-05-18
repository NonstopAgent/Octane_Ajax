import type {
  AgentStatus,
  ContentJobStatus,
  IdeaStatus,
  ListingStatus,
  ReviewStatus,
  TaskStatus,
} from "@/lib/ajax/status";

export type AgentSlug = "nova" | "forge" | "pixel";

export type RoomSlug =
  | "research_lab"
  | "design_press"
  | "review_gate"
  | "media_studio"
  | "storefront";

export interface AjaxAgent {
  id: string;
  slug: AgentSlug;
  name: string;
  role: string;
  status: AgentStatus;
  currentRoom: RoomSlug | string | null;
  currentTaskId: string | null;
  autonomyLevel: number;
  lastHeartbeat: string | null;
  createdAt: string;
}

export interface AjaxTask {
  id: string;
  userId: string;
  agentSlug: AgentSlug | string;
  taskType: string;
  status: TaskStatus;
  priority: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ProductIdea {
  id: string;
  userId: string;
  source: string;
  niche: string | null;
  title: string | null;
  description: string | null;
  seoKeywords: string[];
  trendScore: number;
  status: IdeaStatus;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface ProductListing {
  id: string;
  userId: string;
  productIdeaId: string;
  title: string | null;
  description: string | null;
  price: number | null;
  mockupUrl: string | null;
  platform: string;
  externalListingId: string | null;
  gumroadUrl: string | null;
  gumroadProductId: string | null;
  status: ListingStatus;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  userId: string;
  listingId: string;
  status: ReviewStatus;
  reviewerNotes: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Populated when joined with listings */
  listing?: ProductListing;
}

export interface FactoryEvent {
  id: string;
  userId: string;
  eventType: string;
  agentSlug: AgentSlug | string | null;
  room: RoomSlug | string | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContentJob {
  id: string;
  userId: string;
  listingId: string;
  platform: string;
  contentType: string;
  status: ContentJobStatus;
  assetUrl: string | null;
  caption: string | null;
  scheduledFor: string | null;
  createdAt: string;
}

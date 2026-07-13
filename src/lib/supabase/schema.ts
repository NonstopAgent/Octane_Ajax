/** Slugs for seeded system agents (see migration seed). */
export const AGENT_SLUGS = {
  NOVA: "nova",
  FORGE: "forge",
  PIXEL: "pixel",
} as const;

export type AgentSlug = (typeof AGENT_SLUGS)[keyof typeof AGENT_SLUGS];

export const AGENT_STATUSES = [
  "idle",
  "working",
  "waiting",
  "error",
  "offline",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TASK_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const IDEA_STATUSES = [
  "idea",
  "selected",
  "rejected",
  "archived",
] as const;

export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const LISTING_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "published",
  "archived",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const CONTENT_JOB_STATUSES = [
  "queued",
  "generating",
  "ready",
  "scheduled",
  "published",
  "failed",
] as const;

export type ContentJobStatus = (typeof CONTENT_JOB_STATUSES)[number];

export const PRODUCT_BRAIN_VERDICTS = [
  "approve_for_generation",
  "needs_revision",
  "blocked",
] as const;

export type ProductBrainVerdictDb =
  (typeof PRODUCT_BRAIN_VERDICTS)[number];

export const GENERATION_STATUSES = [
  "pending",
  "queued",
  "generating",
  "ready",
  "failed",
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const FACTORY_ROOMS = {
  RESEARCH_LAB: "research_lab",
  DESIGN_PRESS: "design_press",
  REVIEW_GATE: "review_gate",
  MEDIA_STUDIO: "media_studio",
  STOREFRONT: "storefront",
  PERSONALIZATION_BAY: "personalization_bay",
} as const;

export const ORDER_QUEUE_STATUSES = [
  "pending_personalization",
  "processing_artwork",
  "fulfillment_ready",
  "production_submitted",
  "failed",
] as const;

export type OrderQueueStatusDb =
  (typeof ORDER_QUEUE_STATUSES)[number];

export const TIKTOK_QUEUE_STATUSES = [
  "pending",
  "approved",
  "posted",
  "rejected",
] as const;

export type TikTokQueueStatusDb = (typeof TIKTOK_QUEUE_STATUSES)[number];

export type FactoryRoom = (typeof FACTORY_ROOMS)[keyof typeof FACTORY_ROOMS];

export const TABLES = {
  BUSINESSES: "businesses",
  AGENTS: "ajax_agents",
  TASKS: "ajax_tasks",
  IDEAS: "product_ideas",
  LISTINGS: "product_listings",
  GENERATIONS: "product_generations",
  REVIEW_QUEUE: "review_queue",
  FEEDBACK: "agent_feedback",
  EVENTS: "factory_events",
  CONTENT_JOBS: "content_jobs",
  ETSY_CREDENTIALS: "etsy_credentials",
  ORDER_QUEUE: "order_queue",
  TIKTOK_QUEUE: "tiktok_queue",
  STRATEGY: "strategy_recommendations",
  LLM_USAGE: "llm_usage_log",
  MARKET_KEYWORDS: "market_keywords",
  VIDEO_JOBS: "video_jobs",
  LISTING_PERFORMANCE: "listing_performance_snapshots",
  ETSY_OAUTH_SESSIONS: "etsy_oauth_sessions",
  GUIDES: "affiliate_guides",
  AFFILIATE_LINKS: "affiliate_links",
  AFFILIATE_CLICKS: "affiliate_clicks",
} as const;

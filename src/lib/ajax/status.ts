/** Domain status unions for the Ajax pipeline. */

export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting_review"
  | "error";

export type TaskStatus = "queued" | "running" | "completed" | "failed";

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "published";

/**
 * Listing lifecycle (demo storefront only — no external Etsy publish).
 *
 * ```
 * draft ──► pending_review ──approve──► approved ──Pixel──► published
 *                      └──reject──► rejected
 * ```
 *
 * `approved` is brief when approve runs Pixel inline; listings can remain
 * `approved` if Pixel fails (retry via POST /api/ajax/run-pixel).
 */
export const LISTING_STATUS_TRANSITIONS: Readonly<
  Record<ListingStatus, readonly ListingStatus[]>
> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["published"],
  rejected: [],
  published: [],
};

export type ReviewStatus = "pending" | "approved" | "rejected";

/** Review queue statuses (human gate — no auto-external publish). */
export const REVIEW_STATUS_TRANSITIONS: Readonly<
  Record<ReviewStatus, readonly ReviewStatus[]>
> = {
  pending: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export type IdeaStatus = "idea" | "selected" | "rejected" | "archived";

export type ContentJobStatus =
  | "queued"
  | "generating"
  | "ready"
  | "scheduled"
  | "published"
  | "failed";

export const AGENT_STATUSES: readonly AgentStatus[] = [
  "idle",
  "thinking",
  "working",
  "waiting_review",
  "error",
];

export const TASK_STATUSES: readonly TaskStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
];

export const LISTING_STATUSES: readonly ListingStatus[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "published",
];

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending",
  "approved",
  "rejected",
];

export type PipelineStatus =
  | AgentStatus
  | TaskStatus
  | ListingStatus
  | ReviewStatus
  | IdeaStatus
  | ContentJobStatus;

const STATUS_LABELS: Record<string, string> = {
  // Agent
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting_review: "Waiting for review",
  error: "Error",
  // Task
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  // Listing
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  // Review
  pending: "Pending",
  // Idea
  idea: "Idea",
  selected: "Selected",
  archived: "Archived",
  // Content job
  generating: "Generating",
  ready: "Ready",
  scheduled: "Scheduled",
};

/** Human-readable label for any pipeline status string. */
export function getStatusLabel(status: PipelineStatus | string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isListingStatus(value: string): value is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(value);
}

export function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

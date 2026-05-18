import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  forgeResultToCompliance,
  runForgeGeneration,
} from "@/lib/ajax/forge";
import {
  mapNovaIdeasToDbInserts,
  pickForgeIdeaCandidate,
  runNovaIdeation,
} from "@/lib/ajax/nova";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  normalizeProductCategory,
  normalizeProductFormat,
} from "@/lib/ajax/nova/types";
import { mapGenerationToDbInsert, mapIdeaBrainFromDb } from "@/lib/product/mappers";
import type { ProductIdea as DbIdea } from "@/lib/supabase/database.types";
import {
  mapEventFromDb,
  mapIdeaFromDb,
  mapListingFromDb,
  mapReviewFromDb,
  mapTaskFromDb,
} from "@/lib/ajax/mappers";
import type {
  FactoryEvent,
  ProductIdea,
  ProductListing,
  ReviewItem,
} from "@/lib/ajax/types";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Pacing delays so Realtime UI can render each agent state transition. */
const CYCLE_PACING = {
  bootMs: 600, // after "factory online"
  agentWorkMs: 1800, // while an agent is in "working" state
  handoffMs: 1000, // beat between agents
  settleMs: 600, // before the final "cycle paused" event
} as const;
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** DB `ajax_agents.status` values (see migration check constraint). */
type DbAgentStatus = "idle" | "working" | "waiting" | "error" | "offline";

export class CycleBlockedError extends Error {
  readonly code = "CYCLE_BLOCKED" as const;

  constructor(
    message = "A listing is already waiting at the Review Gate. Approve or reject it before running a new cycle.",
  ) {
    super(message);
    this.name = "CycleBlockedError";
  }
}

export class SimulatorError extends Error {
  readonly code = "SIMULATOR_ERROR" as const;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SimulatorError";
  }
}

export type AjaxCycleSummary = {
  ok: true;
  step: "forge";
  stoppedAt: "review_gate";
  runId: string;
  message: string;
  ideas: ProductIdea[];
  selectedIdea: ProductIdea;
  listing: ProductListing;
  generationId: string;
  review: ReviewItem;
  events: FactoryEvent[];
  tasks: ReturnType<typeof mapTaskFromDb>[];
};

export type NovaStepSummary = {
  ok: true;
  step: "nova";
  runId: string;
  message: string;
  ideas: ProductIdea[];
  selectedIdea: ProductIdea;
  events: FactoryEvent[];
  tasks: ReturnType<typeof mapTaskFromDb>[];
};

export type RunForgeStepOptions = {
  /** Cycle run from Nova; when omitted, uses the latest idea batch for this user. */
  runId?: string;
};

const AGENT_SEED = [
  {
    name: "Nova",
    slug: AGENT_SLUGS.NOVA,
    role: "researcher",
    status: "idle" as DbAgentStatus,
    current_room: ROOM_SLUGS.RESEARCH_LAB,
    autonomy_level: 0,
  },
  {
    name: "Forge",
    slug: AGENT_SLUGS.FORGE,
    role: "creator/operator",
    status: "idle" as DbAgentStatus,
    current_room: ROOM_SLUGS.DESIGN_PRESS,
    autonomy_level: 0,
  },
  {
    name: "Pixel",
    slug: AGENT_SLUGS.PIXEL,
    role: "media marketer",
    status: "idle" as DbAgentStatus,
    current_room: ROOM_SLUGS.MEDIA_STUDIO,
    autonomy_level: 0,
  },
] as const;

/** Each agent's home room — used to return the floor to idle after a failed cycle. */
const AGENT_HOME_ROOM: Record<string, string> = {
  [AGENT_SLUGS.NOVA]: ROOM_SLUGS.RESEARCH_LAB,
  [AGENT_SLUGS.FORGE]: ROOM_SLUGS.DESIGN_PRESS,
  [AGENT_SLUGS.PIXEL]: ROOM_SLUGS.MEDIA_STUDIO,
};

async function assertAgentsExist(supabase: Supabase) {
  const { data, error } = await supabase
    .from(TABLES.AGENTS)
    .select("slug")
    .in("slug", [AGENT_SLUGS.NOVA, AGENT_SLUGS.FORGE, AGENT_SLUGS.PIXEL]);

  if (error) {
    throw new SimulatorError("Failed to load system agents.", error);
  }

  const slugs = new Set((data ?? []).map((a) => a.slug));
  const missing = [AGENT_SLUGS.NOVA, AGENT_SLUGS.FORGE, AGENT_SLUGS.PIXEL].filter(
    (s) => !slugs.has(s),
  );

  if (missing.length > 0) {
    throw new SimulatorError(
      `Missing seeded agents: ${missing.join(", ")}. Run the Supabase migration or reset-demo.`,
    );
  }
}

async function preflightCycle(supabase: Supabase, userId: string) {
  await assertAgentsExist(supabase);
  await assertNoPendingReview(supabase, userId);
}

function ideaRowToNovaEvaluated(row: DbIdea): NovaEvaluatedIdea | null {
  const brain = mapIdeaBrainFromDb(row);
  if (!brain || brain.verdict === "blocked") return null;

  const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
  const ideationMode = raw.ideationMode === "llm" ? "llm" : "fallback";

  return {
    niche: row.niche ?? "",
    targetBuyer: String(raw.targetBuyer ?? ""),
    problemSolved: String(raw.problemSolved ?? ""),
    productConcept: row.title ?? "",
    format: normalizeProductFormat(String(raw.format ?? "planner")),
    category: normalizeProductCategory(String(raw.category ?? "productivity")),
    suggestedPrice: Number(raw.suggestedPrice ?? 0),
    keywords: row.seo_keywords ?? [],
    reasoning: String(raw.reasoning ?? ""),
    source: ideationMode,
    score: brain.score,
    validation: brain.validation,
    verdict: brain.verdict,
    trendScore: Number(row.trend_score),
    llmModel: typeof raw.llmModel === "string" ? raw.llmModel : undefined,
  };
}

async function resolveRunIdeasForForge(
  supabase: Supabase,
  userId: string,
  runId?: string,
): Promise<{ runId: string; ideaRows: DbIdea[] }> {
  const { data, error } = await supabase
    .from(TABLES.IDEAS)
    .select("*")
    .eq("user_id", userId)
    .in("status", ["idea", "selected"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new SimulatorError("Failed to load product ideas for Forge.", error);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    throw new SimulatorError(
      "No Forge-ready ideas found. Run Nova first (POST /api/ajax/run-nova).",
    );
  }

  const runIdFromRow = (row: DbIdea) => {
    const payload = row.raw_payload as Record<string, unknown> | null;
    return typeof payload?.runId === "string" ? payload.runId : null;
  };

  const targetRunId = runId ?? runIdFromRow(rows[0]!);
  if (!targetRunId) {
    throw new SimulatorError("Could not determine cycle runId for Forge.");
  }

  const ideaRows = rows.filter((row) => runIdFromRow(row) === targetRunId);
  if (ideaRows.length === 0) {
    throw new SimulatorError(
      `No product ideas found for run ${targetRunId}. Run Nova or pass a valid runId.`,
    );
  }

  return { runId: targetRunId, ideaRows };
}

async function assertForgeNotComplete(
  supabase: Supabase,
  userId: string,
  ideaIds: string[],
) {
  const { data, error } = await supabase
    .from(TABLES.LISTINGS)
    .select("id")
    .eq("user_id", userId)
    .in("product_idea_id", ideaIds)
    .limit(1);

  if (error) {
    throw new SimulatorError("Failed to check existing listings.", error);
  }

  if (data && data.length > 0) {
    throw new SimulatorError(
      "Forge already completed for this cycle. Visit /review or reset the factory.",
    );
  }
}

async function assertNoPendingReview(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(1);

  if (error) {
    throw new SimulatorError("Failed to check review queue.", error);
  }

  if (data && data.length > 0) {
    throw new CycleBlockedError();
  }
}

async function insertEvent(
  supabase: Supabase,
  userId: string,
  payload: {
    event_type: string;
    message: string;
    agent_slug?: string | null;
    room?: string | null;
    metadata?: Json;
  },
) {
  const { data, error } = await supabase
    .from(TABLES.EVENTS)
    .insert({
      user_id: userId,
      event_type: payload.event_type,
      message: payload.message,
      agent_slug: payload.agent_slug ?? null,
      room: payload.room ?? null,
      metadata: payload.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    throw new SimulatorError(`Failed to log factory event: ${payload.event_type}`, error);
  }

  return mapEventFromDb(data);
}

async function setAgentState(
  supabase: Supabase,
  slug: string,
  patch: {
    status: DbAgentStatus;
    current_room?: string | null;
    current_task_id?: string | null;
  },
) {
  const { error } = await supabase
    .from(TABLES.AGENTS)
    .update({
      status: patch.status,
      current_room: patch.current_room,
      current_task_id: patch.current_task_id ?? null,
      last_heartbeat: new Date().toISOString(),
    })
    .eq("slug", slug);

  if (error) {
    throw new SimulatorError(`Failed to update agent "${slug}".`, error);
  }
}

async function createTask(
  supabase: Supabase,
  userId: string,
  agentSlug: string,
  taskType: string,
) {
  const startedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .insert({
      user_id: userId,
      agent_slug: agentSlug,
      task_type: taskType,
      status: "running",
      priority: 5,
      input: { simulated: true, cycle: "ajax-demo" },
      started_at: startedAt,
    })
    .select()
    .single();

  if (error) {
    throw new SimulatorError(`Failed to create task "${taskType}".`, error);
  }

  return data;
}

async function completeTask(supabase: Supabase, taskId: string, output: Json) {
  const { data, error } = await supabase
    .from(TABLES.TASKS)
    .update({
      status: "completed",
      output,
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select()
    .single();

  if (error) {
    throw new SimulatorError("Failed to complete task.", error);
  }

  return mapTaskFromDb(data);
}

/**
 * Best-effort recovery after a mid-cycle failure: returns the three agents
 * to idle and logs a cycle_failed event so the factory floor doesn't show a
 * stuck "working" agent. Each step is independently guarded — recovery never
 * masks or replaces the original error.
 */
async function recoverFromCycleFailure(
  supabase: Supabase,
  userId: string,
  cause: unknown,
) {
  for (const slug of [AGENT_SLUGS.NOVA, AGENT_SLUGS.FORGE, AGENT_SLUGS.PIXEL]) {
    try {
      await setAgentState(supabase, slug, {
        status: "idle",
        current_room: AGENT_HOME_ROOM[slug],
        current_task_id: null,
      });
    } catch (recoveryErr) {
      console.error(`[ajax-cycle recovery] could not idle ${slug}`, recoveryErr);
    }
  }

  try {
    await insertEvent(supabase, userId, {
      event_type: "cycle_failed",
      message:
        "Ajax cycle failed mid-run. Agents returned to idle — run Reset factory if the floor looks inconsistent.",
      metadata: {
        error: cause instanceof Error ? cause.message : String(cause),
      },
    });
  } catch (logErr) {
    console.error("[ajax-cycle recovery] could not log cycle_failed", logErr);
  }
}

/**
 * Nova-only pipeline step: ideation → product_ideas rows (Forge runs separately).
 */
export async function runNovaStep(
  supabase: Supabase,
  userId: string,
): Promise<NovaStepSummary> {
  await preflightCycle(supabase, userId);

  try {
    return await executeNovaStep(supabase, userId);
  } catch (err) {
    await recoverFromCycleFailure(supabase, userId, err);
    throw err;
  }
}

/**
 * Forge-only pipeline step: listing + generation + review queue → Review Gate pause.
 * Reuses the highest valid idea from a prior Nova run when `runId` is omitted.
 */
export async function runForgeStep(
  supabase: Supabase,
  userId: string,
  opts?: RunForgeStepOptions,
): Promise<AjaxCycleSummary> {
  await preflightCycle(supabase, userId);

  try {
    return await executeForgeStep(supabase, userId, opts);
  } catch (err) {
    await recoverFromCycleFailure(supabase, userId, err);
    throw err;
  }
}

/** Nova ideation and persistence — wrapped by runNovaStep for recovery. */
async function executeNovaStep(
  supabase: Supabase,
  userId: string,
): Promise<NovaStepSummary> {
  const runId = crypto.randomUUID();
  const events: FactoryEvent[] = [];
  const tasks: ReturnType<typeof mapTaskFromDb>[] = [];

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "cycle_started",
      message: "Ajax cycle started. Factory online.",
      metadata: { runId },
    }),
  );
  await sleep(CYCLE_PACING.bootMs);

  const novaTaskRow = await createTask(
    supabase,
    userId,
    AGENT_SLUGS.NOVA,
    "trend_research",
  );

  await setAgentState(supabase, AGENT_SLUGS.NOVA, {
    status: "working",
    current_room: ROOM_SLUGS.RESEARCH_LAB,
    current_task_id: novaTaskRow.id,
  });

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "agent_started",
      agent_slug: AGENT_SLUGS.NOVA,
      room: ROOM_SLUGS.RESEARCH_LAB,
      message: "Nova is scanning trend signals...",
      metadata: { taskId: novaTaskRow.id, runId },
    }),
  );
  await sleep(CYCLE_PACING.agentWorkMs);

  const novaResult = await runNovaIdeation(runId);
  const ideaInserts = mapNovaIdeasToDbInserts(userId, runId, novaResult);

  if (ideaInserts.length === 0) {
    throw new SimulatorError(
      "Nova produced no product ideas that passed Product Brain.",
    );
  }

  const { data: ideaRows, error: ideasError } = await supabase
    .from(TABLES.IDEAS)
    .insert(ideaInserts)
    .select();

  if (ideasError || !ideaRows?.length) {
    throw new SimulatorError("Failed to insert product ideas.", ideasError);
  }

  const ideas = ideaRows.map(mapIdeaFromDb);

  const forgePick = pickForgeIdeaCandidate(novaResult.ideas);
  const forgeIndex = novaResult.ideas.indexOf(forgePick);
  const selectedRow = ideaRows[forgeIndex >= 0 ? forgeIndex : 0]!;

  tasks.push(
    await completeTask(supabase, novaTaskRow.id, {
      ideaIds: ideaRows.map((i) => i.id),
      ideaCount: ideaRows.length,
      ideationMode: novaResult.mode,
      promptVersion: novaResult.promptVersion,
    }),
  );

  await setAgentState(supabase, AGENT_SLUGS.NOVA, {
    status: "idle",
    current_room: ROOM_SLUGS.RESEARCH_LAB,
    current_task_id: null,
  });

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "idea_created",
      agent_slug: AGENT_SLUGS.NOVA,
      room: ROOM_SLUGS.RESEARCH_LAB,
      message: `Nova generated ${ideas.length} product ideas (${novaResult.mode} mode).`,
      metadata: {
        ideaIds: ideas.map((i) => i.id),
        runId,
        ideationMode: novaResult.mode,
        promptVersion: novaResult.promptVersion,
      },
    }),
  );
  await sleep(CYCLE_PACING.handoffMs);

  const selectedIdea = mapIdeaFromDb(selectedRow);

  return {
    ok: true,
    step: "nova",
    runId,
    message: `Nova generated ${ideas.length} ideas. Run Forge to continue.`,
    ideas,
    selectedIdea,
    events,
    tasks,
  };
}

/** Forge listing + review gate — wrapped by runForgeStep for recovery. */
async function executeForgeStep(
  supabase: Supabase,
  userId: string,
  opts?: RunForgeStepOptions,
): Promise<AjaxCycleSummary> {
  const { runId, ideaRows } = await resolveRunIdeasForForge(
    supabase,
    userId,
    opts?.runId,
  );

  await assertForgeNotComplete(
    supabase,
    userId,
    ideaRows.map((row) => row.id),
  );

  const evaluated = ideaRows
    .map(ideaRowToNovaEvaluated)
    .filter((idea): idea is NovaEvaluatedIdea => idea !== null);

  if (evaluated.length === 0) {
    throw new SimulatorError(
      "No Forge-eligible ideas in this run (all blocked by Product Brain).",
    );
  }

  const forgePick = pickForgeIdeaCandidate(evaluated);
  const forgeIndex = evaluated.indexOf(forgePick);
  const selectedRow = ideaRows[forgeIndex >= 0 ? forgeIndex : 0]!;

  const events: FactoryEvent[] = [];
  const tasks: ReturnType<typeof mapTaskFromDb>[] = [];

  await supabase
    .from(TABLES.IDEAS)
    .update({ status: "selected" })
    .eq("id", selectedRow.id);

  const selectedIdea = mapIdeaFromDb({ ...selectedRow, status: "selected" });
  const ideas = ideaRows.map(mapIdeaFromDb);

  const forgeTaskRow = await createTask(
    supabase,
    userId,
    AGENT_SLUGS.FORGE,
    "generate_listing",
  );

  await setAgentState(supabase, AGENT_SLUGS.FORGE, {
    status: "working",
    current_room: ROOM_SLUGS.DESIGN_PRESS,
    current_task_id: forgeTaskRow.id,
  });

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "agent_started",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "Forge is turning a product idea into a listing...",
      metadata: { taskId: forgeTaskRow.id, productIdeaId: selectedRow.id, runId },
    }),
  );
  await sleep(CYCLE_PACING.agentWorkMs);

  const forgeResult = await runForgeGeneration({
    runId,
    idea: forgePick,
  });
  const compliance = forgeResultToCompliance(forgeResult);

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .insert({
      user_id: userId,
      product_idea_id: selectedRow.id,
      title: forgeResult.listingTitle,
      description: forgeResult.listingDescription,
      price: forgeResult.suggestedPrice,
      mockup_url: null,
      platform: "demo",
      status: "pending_review",
    })
    .select()
    .single();

  if (listingError || !listingRow) {
    throw new SimulatorError("Failed to create product listing.", listingError);
  }

  const listing = mapListingFromDb(listingRow);

  const generationInsert = mapGenerationToDbInsert({
    userId,
    productIdeaId: selectedRow.id,
    productListingId: listingRow.id,
    structure: forgeResult.productStructure,
    llm: {
      provider: forgeResult.mode === "llm" ? "openai" : null,
      model: forgeResult.llmModel ?? null,
      promptVersion: forgeResult.promptVersion,
      tokenEstimateInput: forgeResult.tokenEstimateInput ?? null,
      tokenEstimateOutput: forgeResult.tokenEstimateOutput ?? null,
    },
    generationStatus: "queued",
    pdf: { storagePath: null, publicUrl: null },
    complianceFlags: compliance.flags,
    complianceWarnings: compliance.warnings,
  });

  const { data: generationRow, error: generationError } = await supabase
    .from(TABLES.GENERATIONS)
    .insert(generationInsert)
    .select()
    .single();

  if (generationError || !generationRow) {
    throw new SimulatorError(
      "Failed to create product generation.",
      generationError,
    );
  }

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "pdf_queued",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.DESIGN_PRESS,
      message: "PDF generation queued — printable asset will build in the background.",
      metadata: {
        generationId: generationRow.id,
        listingId: listingRow.id,
        runId,
      },
    }),
  );

  const { data: reviewRow, error: reviewError } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .insert({
      user_id: userId,
      listing_id: listingRow.id,
      status: "pending",
    })
    .select()
    .single();

  if (reviewError || !reviewRow) {
    throw new SimulatorError("Failed to create review queue item.", reviewError);
  }

  const review = mapReviewFromDb(reviewRow);

  tasks.push(
    await completeTask(supabase, forgeTaskRow.id, {
      listingId: listingRow.id,
      reviewId: reviewRow.id,
      productIdeaId: selectedRow.id,
      generationId: generationRow.id,
      forgeMode: forgeResult.mode,
      promptVersion: forgeResult.promptVersion,
      seoTags: forgeResult.seoTags,
      coverImagePrompt: forgeResult.coverImagePrompt,
      revisionNotes: forgeResult.revisionNotes,
      aiDisclosure: forgeResult.aiDisclosure,
    }),
  );

  // Domain "waiting_review" → DB status "waiting"
  await setAgentState(supabase, AGENT_SLUGS.FORGE, {
    status: "waiting",
    current_room: ROOM_SLUGS.REVIEW_GATE,
    current_task_id: null,
  });

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "review_requested",
      agent_slug: AGENT_SLUGS.FORGE,
      room: ROOM_SLUGS.REVIEW_GATE,
      message: "Forge sent a listing to the review gate.",
      metadata: { listingId: listingRow.id, reviewId: reviewRow.id, runId },
    }),
  );
  await sleep(CYCLE_PACING.settleMs);

  // Step 3 — intentional pause; Pixel / publish not invoked
  const message =
    "Cycle paused at Review Gate. Approve or reject the listing to continue.";

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "cycle_paused",
      room: ROOM_SLUGS.REVIEW_GATE,
      message,
      metadata: { stoppedAt: "review_gate", runId },
    }),
  );

  return {
    ok: true,
    step: "forge",
    stoppedAt: "review_gate",
    runId,
    message,
    ideas,
    selectedIdea,
    listing,
    generationId: generationRow.id,
    review,
    events,
    tasks,
  };
}

export type ResetDemoSummary = {
  ok: true;
  message: string;
  deleted: Record<string, number>;
  agents: { slug: string; status: string }[];
};

/**
 * Clears the current user's demo pipeline data and resets agent rows to seed state.
 * Does not delete or duplicate agent rows — upserts the three system agents.
 */
export async function resetDemoData(
  supabase: Supabase,
  userId: string,
): Promise<ResetDemoSummary> {
  const deleted: Record<string, number> = {};

  const userTables = [
    TABLES.CONTENT_JOBS,
    TABLES.FEEDBACK,
    TABLES.REVIEW_QUEUE,
    TABLES.GENERATIONS,
    TABLES.LISTINGS,
    TABLES.IDEAS,
    TABLES.TASKS,
    TABLES.EVENTS,
  ] as const;

  for (const table of userTables) {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .select("id");

    if (error) {
      throw new SimulatorError(`Failed to clear table "${table}".`, error);
    }

    deleted[table] = data?.length ?? 0;
  }

  // Reseed agent rows (upsert by slug — never duplicates)
  const { data: agents, error: agentError } = await supabase
    .from(TABLES.AGENTS)
    .upsert(
      AGENT_SEED.map((row) => ({
        ...row,
        current_task_id: null,
        last_heartbeat: new Date().toISOString(),
      })),
      { onConflict: "slug" },
    )
    .select("slug, status");

  if (agentError) {
    throw new SimulatorError("Failed to reseed agents.", agentError);
  }

  await insertEvent(supabase, userId, {
    event_type: "demo_reset",
    message: "Demo data cleared. Agents reset to idle.",
    metadata: { deleted },
  });

  return {
    ok: true,
    message: "Demo data cleared and agents reseeded.",
    deleted,
    agents: (agents ?? []).map((a) => ({ slug: a.slug, status: a.status })),
  };
}

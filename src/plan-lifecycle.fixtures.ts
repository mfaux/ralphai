/**
 * Shared test fixture builders for plan-lifecycle objects.
 *
 * Reduces duplication across test files that need plan, receipt,
 * frontmatter, or pipeline-state objects with sensible defaults.
 */
import type {
  PlanFrontmatter,
  IssueFrontmatter,
  Receipt,
  InitReceiptFields,
  BacklogPlan,
  InProgressPlan,
  LivenessStatus,
  PipelineState,
  WorktreeState,
  WorktreeEntry,
  PipelineProblem,
  PlanFormatResult,
  PlanFormat,
} from "./plan-lifecycle.ts";

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER_DEFAULTS: PlanFrontmatter = {
  scope: "",
  feedbackScope: "",
  dependsOn: [],
  source: "",
  issue: undefined,
  issueUrl: "",
  prd: undefined,
};

export function makePlanFrontmatter(
  overrides?: Partial<PlanFrontmatter>,
): PlanFrontmatter {
  return { ...FRONTMATTER_DEFAULTS, ...overrides };
}

const ISSUE_FM_DEFAULTS: IssueFrontmatter = {
  source: "",
  issue: undefined,
  issueUrl: "",
  prd: undefined,
};

export function makeIssueFrontmatter(
  overrides?: Partial<IssueFrontmatter>,
): IssueFrontmatter {
  return { ...ISSUE_FM_DEFAULTS, ...overrides };
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

const RECEIPT_DEFAULTS: Receipt = {
  started_at: "2025-01-01T00:00:00.000Z",
  branch: "feat/test-plan",
  slug: "test-plan",
  tasks_completed: 0,
};

export function makeReceipt(overrides?: Partial<Receipt>): Receipt {
  return { ...RECEIPT_DEFAULTS, ...overrides };
}

const INIT_RECEIPT_DEFAULTS: InitReceiptFields = {
  branch: "feat/test-plan",
  slug: "test-plan",
  plan_file: "plan.md",
};

export function makeInitReceiptFields(
  overrides?: Partial<InitReceiptFields>,
): InitReceiptFields {
  return { ...INIT_RECEIPT_DEFAULTS, ...overrides };
}

// ---------------------------------------------------------------------------
// Pipeline state
// ---------------------------------------------------------------------------

export function makeBacklogPlan(overrides?: Partial<BacklogPlan>): BacklogPlan {
  return { filename: "plan-1.md", scope: "", dependsOn: [], ...overrides };
}

export function makeInProgressPlan(
  overrides?: Partial<InProgressPlan>,
): InProgressPlan {
  return {
    filename: "plan-1.md",
    slug: "plan-1",
    scope: "",
    totalTasks: undefined,
    tasksCompleted: 0,
    hasWorktree: false,
    liveness: { tag: "in_progress" },
    ...overrides,
  };
}

export function makeWorktreeEntry(
  overrides?: Partial<WorktreeEntry>,
): WorktreeEntry {
  return { path: "/tmp/worktree", branch: "feat/test", ...overrides };
}

export function makeWorktreeState(
  overrides?: Partial<WorktreeState>,
): WorktreeState {
  return {
    entry: makeWorktreeEntry(),
    hasActivePlan: false,
    ...overrides,
  };
}

export function makePipelineState(
  overrides?: Partial<PipelineState>,
): PipelineState {
  return {
    backlog: [],
    inProgress: [],
    completedSlugs: [],
    worktrees: [],
    problems: [],
    ...overrides,
  };
}

export function makePlanFormatResult(
  overrides?: Partial<PlanFormatResult>,
): PlanFormatResult {
  return { format: "tasks" as PlanFormat, totalTasks: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// Markdown helpers — build plan content strings for filesystem tests
// ---------------------------------------------------------------------------

/** Build a minimal plan markdown string with optional frontmatter. */
export function buildPlanMarkdown(opts?: {
  title?: string;
  scope?: string;
  dependsOn?: string[];
  feedbackScope?: string;
  source?: string;
  issue?: number;
  issueUrl?: string;
  prd?: number;
  body?: string;
}): string {
  const parts: string[] = [];
  const fm: string[] = [];

  if (opts?.scope) fm.push(`scope: ${opts.scope}`);
  if (opts?.feedbackScope) fm.push(`feedback-scope: ${opts.feedbackScope}`);
  if (opts?.dependsOn?.length) {
    fm.push(`depends-on: [${opts.dependsOn.join(", ")}]`);
  }
  if (opts?.source) fm.push(`source: ${opts.source}`);
  if (opts?.issue !== undefined) fm.push(`issue: ${opts.issue}`);
  if (opts?.issueUrl) fm.push(`issue-url: ${opts.issueUrl}`);
  if (opts?.prd !== undefined) fm.push(`prd: ${opts.prd}`);

  if (fm.length) {
    parts.push("---", ...fm, "---", "");
  }

  parts.push(`# ${opts?.title ?? "Test Plan"}`, "");
  if (opts?.body) parts.push(opts.body, "");

  return parts.join("\n");
}

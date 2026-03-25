/**
 * Shared types for the dashboard components.
 */

/** Which component currently owns keyboard input. */
export type FocusTarget = "list" | "detail" | "menu" | "filter" | "help";

/** Tabs available in the detail overlay. */
export type DetailTab = "summary" | "plan" | "progress" | "output";

/** A single item in an action context menu. */
export interface ActionMenuItem {
  label: string;
  action: string;
  shortcut?: string;
}

/**
 * Context for building action menu items.
 * Replaces the old PanelId approach with a simpler "what is selected" model.
 */
export type ActionContext = "plan" | "worktree" | "none";

// ---------------------------------------------------------------------------
// Worktree data
// ---------------------------------------------------------------------------

/** A git worktree entry filtered to ralphai branches. */
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  /** Branch name with `ralphai/` prefix stripped. */
  shortBranch: string;
  /** Whether a runner is currently active in this worktree. */
  status: "active" | "idle";
  /** Linked plan slug if a match is found. */
  linkedPlan?: string;
}

// ---------------------------------------------------------------------------
// Plan data
// ---------------------------------------------------------------------------

export interface PlanInfo {
  filename: string;
  slug: string;
  state: "backlog" | "in-progress" | "completed";
  scope?: string;
  deps?: string[];
  tasksCompleted?: number;
  totalTasks?: number;
  outcome?: string;
  receiptSource?: "main" | "worktree";
  /** Extra receipt fields for the summary tab. */
  startedAt?: string;
  branch?: string;
  worktreePath?: string;
}

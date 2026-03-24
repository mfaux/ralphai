/**
 * Shared types for the dashboard components.
 */

/** Identifies one of the three left-side panels. */
export type PanelId = "repos" | "pipeline" | "worktrees";

/** Which component currently owns keyboard input. */
export type FocusTarget = "panel" | "detail" | "menu" | "filter" | "help";

/** Tabs available in the detail pane. */
export type DetailTab = "summary" | "plan" | "progress" | "output";

/** A single item in an action context menu. */
export interface ActionMenuItem {
  label: string;
  action: string;
  shortcut?: string;
}

// ---------------------------------------------------------------------------
// Deprecated aliases — kept until old components are removed in Task 5
// ---------------------------------------------------------------------------

/** @deprecated Use PanelId instead. */
export type DashboardScreen = "repos" | "plans";

/** @deprecated Use FocusTarget instead. */
export type PaneFocus = "list" | "detail";

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
  turnsCompleted?: number;
  turnsBudget?: number;
  tasksCompleted?: number;
  totalTasks?: number;
  outcome?: string;
  receiptSource?: "main" | "worktree";
  /** Extra receipt fields for the summary tab. */
  startedAt?: string;
  branch?: string;
  worktreePath?: string;
}

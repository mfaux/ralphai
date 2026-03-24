/**
 * Shared types for the dashboard components.
 */

export type DashboardScreen = "repos" | "plans";

/** Which pane has keyboard focus in the two-pane workspace. */
export type PaneFocus = "list" | "detail";

/** Tabs available in the detail pane. */
export type DetailTab = "summary" | "plan" | "progress" | "output";

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

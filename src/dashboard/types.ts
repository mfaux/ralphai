/**
 * Shared types for the dashboard components.
 */

export type DashboardScreen = "repos" | "plans";

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
}

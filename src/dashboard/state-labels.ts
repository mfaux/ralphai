import type { PlanInfo } from "./types.ts";

export const PLAN_STATE_LABELS: Record<PlanInfo["state"], string> = {
  "in-progress": "In progress",
  backlog: "Backlog",
  completed: "Completed",
};

export function getPlanStateLabel(state: PlanInfo["state"]): string {
  return PLAN_STATE_LABELS[state];
}

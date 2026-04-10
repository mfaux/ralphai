export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

export interface SelectedWorktreePlan {
  planFile: string;
  slug: string;
  source: "backlog" | "in-progress";
}

/** Options for attempting a GitHub issue pull when the local backlog is empty. */
export interface GitHubFallbackOptions {
  /** Configured issue source — pull is only attempted when this is "github". */
  issueSource: string;
  /** Function that attempts to pull a GitHub issue into the backlog. */
  pullFn: () => import("../issue-lifecycle.ts").PullIssueResult;
}

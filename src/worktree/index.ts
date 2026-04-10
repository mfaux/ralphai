export type {
  WorktreeEntry,
  SelectedWorktreePlan,
  GitHubFallbackOptions,
} from "./types.ts";

export {
  parseWorktreeList,
  isRalphaiManagedBranch,
  listRalphaiWorktrees,
} from "./parsing.ts";

export { selectPlanForWorktree } from "./selection.ts";

export {
  isGitWorktree,
  resolveWorktreeInfo,
  resolveMainGitDir,
  resolveMainRepo,
  executeSetupCommand,
  ensureRepoHasCommit,
  prepareWorktree,
  writeFeedbackWrapper,
  type SetupSandboxConfig,
} from "./management.ts";

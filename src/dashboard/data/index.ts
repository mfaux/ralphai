/**
 * Data loading for the dashboard — reads pipeline state from disk.
 *
 * Two sets of loaders:
 * - Sync versions (loadRepos, loadPlans, …) — kept for tests and fallback.
 * - Async versions (loadReposAsync, loadPlansAsync, …) — used by the
 *   dashboard via useAsyncAutoRefresh so heavy I/O never blocks the
 *   main thread (which stalls spinner animations and keyboard input).
 *
 * This barrel re-exports the public API from domain-focused modules.
 */

// Shared helpers (selectively re-exported)
export { pipelineDirsCache, getCachedPipelineDirs } from "./shared.ts";

// Parsing
export { parseReceiptFromContent } from "./parsing.ts";

// Repos
export { loadRepos, loadReposAsync } from "./repos.ts";
export { type RepoSummary } from "./repos.ts";

// Plans
export {
  loadPlans,
  loadPlansAsync,
  loadPlanContent,
  loadPlanContentAsync,
} from "./plans.ts";

// Progress
export { loadProgressContent, loadProgressContentAsync } from "./progress.ts";

// Output
export { loadOutputTail, loadOutputTailAsync } from "./output.ts";

// Worktrees
export { loadWorktrees, loadWorktreesAsync } from "./worktrees.ts";

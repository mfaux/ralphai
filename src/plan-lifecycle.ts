/**
 * Plan lifecycle facade.
 *
 * Unified entry point for all plan-related operations. Re-exports every
 * public function and type from the five underlying modules:
 *
 *   - plan-detection.ts  — plan listing, dependency checking, task counting
 *   - frontmatter.ts     — YAML frontmatter extraction
 *   - receipt.ts         — receipt parsing, creation, updates
 *   - global-state.ts    — pipeline directory resolution, repo registry
 *   - pipeline-state.ts  — aggregated pipeline state gathering
 *
 * Callers that need plan operations should eventually import from this
 * module instead of the individual files. Existing callers are unchanged
 * for now; migration will happen in a follow-up slice.
 */

// -- plan-detection.ts -------------------------------------------------------
export {
  // types
  type DetectedPlan,
  type DetectFailReason,
  type BlockedPlanInfo,
  type DetectPlanResult,
  type DependencyStatus,
  type PlanReadiness,
  type PipelineDirs,
  type PlanFormat,
  type PlanFormatResult,
  // functions
  listPlanFolders,
  planPathForSlug,
  listPlanSlugs,
  listPlanFiles,
  resolvePlanPath,
  planExistsForSlug,
  detectPlanFormat,
  countPlanTasksFromContent,
  countPlanTasks,
  countCompletedFromProgress,
  countCompletedTasks,
  collectBacklogPlans,
  checkDependencyStatus,
  planReadiness,
  getPlanDescription,
  detectPlan,
} from "./plan-detection.ts";

// -- frontmatter.ts ----------------------------------------------------------
export {
  // types
  type PlanFrontmatter,
  type IssueFrontmatter,
  // functions
  extractScope,
  extractDependsOn,
  extractFeedbackScope,
  extractIssueFrontmatter,
  parseFrontmatter,
} from "./frontmatter.ts";

// -- receipt.ts --------------------------------------------------------------
export {
  // types
  type Receipt,
  type InitReceiptFields,
  // functions
  resolveReceiptPath,
  parseReceipt,
  initReceipt,
  updateReceiptTasks,
  updateReceiptPrUrl,
  updateReceiptOutcome,
  findPlansByBranch,
  checkReceiptSource,
} from "./receipt.ts";

// -- global-state.ts ---------------------------------------------------------
export {
  // types
  type RepoSummary,
  // functions
  getRalphaiHome,
  getRepoId,
  resolveRepoStateDir,
  ensureRepoStateDir,
  getRepoPipelineDirs,
  listAllRepos,
  resolveRepoByNameOrPath,
  removeStaleRepos,
} from "./global-state.ts";

// -- pipeline-state.ts -------------------------------------------------------
export {
  // types
  type LivenessStatus,
  type BacklogPlan,
  type InProgressPlan,
  type WorktreeEntry,
  type WorktreeState,
  type PipelineProblem,
  type PipelineState,
  // functions
  gatherPipelineState,
} from "./pipeline-state.ts";

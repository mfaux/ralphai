/**
 * Repository loading for the dashboard.
 */

import { listAllRepos, type RepoSummary } from "../../global-state.ts";
import { yieldToEventLoop } from "./shared.ts";

export { type RepoSummary };

// ---------------------------------------------------------------------------
// Sync loader
// ---------------------------------------------------------------------------

/**
 * Load known repos, filtering out stale empties (dead temp dirs with no plans).
 */
export function loadRepos(): RepoSummary[] {
  return listAllRepos().filter((r) => {
    // Keep repos that still exist on disk
    if (r.pathExists) return true;
    // Keep stale repos that still have plans (user may want to see them)
    if (r.backlogCount > 0 || r.inProgressCount > 0 || r.completedCount > 0)
      return true;
    // Drop stale, empty repos (test leftovers, deleted projects)
    return false;
  });
}

// ---------------------------------------------------------------------------
// Async loader
// ---------------------------------------------------------------------------

/**
 * Async version of loadRepos. Delegates to the sync listAllRepos() but
 * yields to the event loop first so the call is scheduled rather than
 * blocking the current tick. (listAllRepos itself is fast for typical
 * repo counts; the yield is the important part.)
 */
export async function loadReposAsync(): Promise<RepoSummary[]> {
  await yieldToEventLoop();
  return loadRepos();
}

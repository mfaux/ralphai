/**
 * repos command — list all known repos with pipeline summaries.
 */

import { listAllRepos, removeStaleRepos } from "./global-state.ts";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";

export function runRepos(opts?: { clean?: boolean }): void {
  if (opts?.clean) {
    const removed = removeStaleRepos();
    if (removed.length === 0) {
      console.log(`${DIM}No stale repos to remove.${RESET}`);
    } else {
      console.log(
        `${TEXT}Removed ${BOLD}${removed.length}${RESET}${TEXT} stale repo${removed.length === 1 ? "" : "s"}:${RESET}`,
      );
      for (const id of removed) {
        console.log(`  ${DIM}${id}${RESET}`);
      }
    }
    console.log();
  }

  const repos = listAllRepos();

  if (repos.length === 0) {
    console.log(
      `${TEXT}No repos found.${RESET} ${DIM}Run ${TEXT}ralphai init${DIM} inside a git repo to get started.${RESET}`,
    );
    return;
  }

  console.log();
  console.log(`${TEXT}Repos${RESET}`);
  console.log();

  // Column widths
  const maxIdLen = Math.max(...repos.map((r) => r.id.length), 4);
  const maxPathLen = Math.max(
    ...repos.map((r) => (r.repoPath ?? "(unknown)").length),
    4,
  );

  for (const repo of repos) {
    const id = repo.id.padEnd(maxIdLen);
    const path = (repo.repoPath ?? "(unknown)").padEnd(maxPathLen);
    const stale = repo.repoPath && !repo.pathExists ? " [stale]" : "";

    const counts: string[] = [];
    if (repo.backlogCount > 0) {
      counts.push(`${repo.backlogCount} queued`);
    }
    if (repo.inProgressCount > 0) {
      counts.push(`${repo.inProgressCount} active`);
    }
    if (repo.completedCount > 0) {
      counts.push(`${repo.completedCount} done`);
    }
    const summary = counts.length > 0 ? counts.join(", ") : "empty";

    console.log(
      `  ${TEXT}${id}${RESET}  ${DIM}${path}${stale}${RESET}  ${DIM}${summary}${RESET}`,
    );
  }

  console.log();
}

export function showReposHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai repos [--clean]`);
  console.log();
  console.log(`${DIM}List all known repos with pipeline summaries.${RESET}`);
  console.log();
  console.log(`${TEXT}Flags:${RESET}`);
  console.log(
    `  ${TEXT}--clean${RESET}  ${DIM}Remove stale entries (dead paths with no plans)${RESET}`,
  );
}

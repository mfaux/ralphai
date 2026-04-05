import { execSync } from "child_process";
import type { WorktreeEntry } from "./types.ts";

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split("\n")) {
    if (line === "") {
      if (current.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? "",
          head: current.head ?? "",
          bare: current.bare ?? false,
        });
      }
      current = {};
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // branch refs/heads/ralphai/foo → ralphai/foo
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  // Handle last entry if no trailing newline
  if (current.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? "",
      head: current.head ?? "",
      bare: current.bare ?? false,
    });
  }

  return entries;
}

/**
 * Conventional-commit type prefixes used for issue-driven branches.
 * Must stay in sync with `CC_TITLE_PATTERN` in `src/issues.ts`.
 */
const CC_BRANCH_PREFIXES = [
  "feat/",
  "fix/",
  "refactor/",
  "test/",
  "docs/",
  "chore/",
  "ci/",
  "build/",
  "perf/",
  "style/",
  "revert/",
];

export function isRalphaiManagedBranch(branch: string): boolean {
  return (
    branch.startsWith("ralphai/") ||
    CC_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix))
  );
}

export function listRalphaiWorktrees(cwd: string): WorktreeEntry[] {
  const output = execSync("git worktree list --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return parseWorktreeList(output).filter((wt) =>
    isRalphaiManagedBranch(wt.branch),
  );
}

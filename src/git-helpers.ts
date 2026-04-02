import { execSync } from "child_process";

/**
 * Returns true if `dir` is inside a git repository.
 */
export function isInsideGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Extract a trimmed stderr string from an execSync error, if available. */
export function extractExecStderr(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "stderr" in err &&
    (err as { stderr: unknown }).stderr
  ) {
    const raw = (err as { stderr: Buffer | string }).stderr;
    const text = typeof raw === "string" ? raw : raw.toString("utf-8");
    return text.trim();
  }
  return "";
}

export function detectBaseBranch(cwd?: string): string {
  // 1. Remote default branch (most reliable when a remote exists)
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // no remote or origin/HEAD not set
  }

  // 2. Well-known default branch names
  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git show-ref --verify refs/heads/${candidate}`, {
        stdio: "ignore",
        ...(cwd ? { cwd } : {}),
      });
      return candidate;
    } catch {
      // not found, try next
    }
  }

  // 3. Current branch (covers fresh repos with non-standard default names)
  try {
    const current = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
    }).trim();
    if (current) return current;
  } catch {
    // detached HEAD or other edge case
  }

  // 4. Last resort — use HEAD directly so git commands still have a valid ref
  return "HEAD";
}

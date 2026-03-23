import { createHash } from "crypto";
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

/**
 * Returns the global Ralphai home directory.
 * Uses `$RALPHAI_HOME` if set, otherwise `~/.ralphai`.
 */
export function getRalphaiHome(
  env?: Record<string, string | undefined>,
): string {
  const vars = env ?? process.env;
  return vars.RALPHAI_HOME || join(homedir(), ".ralphai");
}

/**
 * Derives a stable repo identifier from the git remote origin URL.
 *
 * Strips protocol prefixes, `.git` suffix, and replaces non-alphanumeric
 * characters with hyphens. Example:
 *   `https://github.com/mfaux/ralphai.git` → `github.com-mfaux-ralphai`
 *
 * Falls back to `_path-<hash>` (first 12 hex chars of SHA-256 of the
 * absolute path) when no remote is available.
 */
export function getRepoId(cwd: string): string {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();

    if (url) {
      return slugifyRemoteUrl(url);
    }
  } catch {
    // No remote, or not a git repo — fall through to path-based ID.
  }

  return pathFallbackId(getRepoIdentityRoot(cwd));
}

/**
 * Computes `<ralphaiHome>/repos/<repoId>` without creating the directory.
 * Use this for read-only checks (e.g., "does the config file exist?").
 */
export function resolveRepoStateDir(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  return join(getRalphaiHome(env), "repos", getRepoId(cwd));
}

/**
 * Returns `<ralphaiHome>/repos/<repoId>`, creating it if missing.
 * Use this only when you intend to write state (config, plans, learnings).
 */
export function ensureRepoStateDir(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  const dir = resolveRepoStateDir(cwd, env);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns pipeline subdirectory paths under the repo state dir,
 * creating them if missing.
 */
export function getRepoPipelineDirs(
  cwd: string,
  env?: Record<string, string | undefined>,
): { backlogDir: string; wipDir: string; archiveDir: string } {
  const base = join(ensureRepoStateDir(cwd, env), "pipeline");
  const backlogDir = join(base, "backlog");
  const wipDir = join(base, "in-progress");
  const archiveDir = join(base, "out");

  for (const d of [backlogDir, wipDir, archiveDir]) {
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
    }
  }

  return { backlogDir, wipDir, archiveDir };
}

/**
 * Returns the path to the LEARNINGS.md file in the repo state dir.
 */
export function getRepoLearningsPath(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  return join(resolveRepoStateDir(cwd, env), "LEARNINGS.md");
}

/**
 * Returns the path to the LEARNING_CANDIDATES.md file in the repo state dir.
 */
export function getRepoCandidatesPath(
  cwd: string,
  env?: Record<string, string | undefined>,
): string {
  return join(resolveRepoStateDir(cwd, env), "LEARNING_CANDIDATES.md");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a git remote URL into a filesystem-safe slug.
 *
 * 1. Strip common protocol prefixes (https://, git@, ssh://, git://)
 * 2. Strip `.git` suffix
 * 3. Replace `:` (SSH-style host separator) with `/`
 * 4. Replace all non-alphanumeric, non-dot, non-slash characters with `-`
 * 5. Replace `/` and `.` with `-` to form the final slug
 * 6. Collapse consecutive hyphens, trim leading/trailing hyphens
 */
function slugifyRemoteUrl(url: string): string {
  let slug = url
    .replace(/^(?:https?:\/\/|ssh:\/\/|git:\/\/)/, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "")
    .replace(/:/g, "/")
    .replace(/[^a-zA-Z0-9./]/g, "-")
    .replace(/[/.]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug;
}

/**
 * Returns a stable repository root for identity fallback.
 *
 * In a normal repo, this is the main working tree root. In a git worktree,
 * this resolves to the main repository root so worktrees share the same
 * global state directory when no remote is configured.
 */
function getRepoIdentityRoot(cwd: string): string {
  try {
    const commonDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      {
        cwd,
        stdio: "pipe",
        encoding: "utf-8",
      },
    ).trim();
    if (commonDir) {
      return dirname(commonDir);
    }
  } catch {
    // Not in a git repo, or git is not available.
  }

  return cwd;
}

/**
 * Produces a `_path-<hash>` identifier from the absolute path.
 * Uses the first 12 hex characters of a SHA-256 hash.
 */
function pathFallbackId(absolutePath: string): string {
  const hash = createHash("sha256")
    .update(absolutePath)
    .digest("hex")
    .slice(0, 12);
  return `_path-${hash}`;
}

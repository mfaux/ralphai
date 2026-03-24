import { createHash } from "crypto";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { dirname, join, resolve as resolvePath } from "path";
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

// ---------------------------------------------------------------------------
// Repo enumeration
// ---------------------------------------------------------------------------

/** Summary of a known repo read from global state. */
export interface RepoSummary {
  /** Directory name under ~/.ralphai/repos/ (the repo ID slug). */
  id: string;
  /** Absolute path to the repo root (from config.json repoPath). */
  repoPath: string | null;
  /** Whether the stored repoPath still exists on disk. */
  pathExists: boolean;
  /** Number of plans in the backlog. */
  backlogCount: number;
  /** Number of plans in progress. */
  inProgressCount: number;
  /** Number of completed plans. */
  completedCount: number;
}

/**
 * Scan `~/.ralphai/repos/` and return a summary for every known repo.
 * Reads each repo's `config.json` for `repoPath` and counts plans in
 * the pipeline subdirectories.
 */
export function listAllRepos(
  env?: Record<string, string | undefined>,
): RepoSummary[] {
  const reposDir = join(getRalphaiHome(env), "repos");
  if (!existsSync(reposDir)) return [];

  const entries = readdirSync(reposDir, { withFileTypes: true });
  const repos: RepoSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const id = entry.name;
    const stateDir = join(reposDir, id);
    const configPath = join(stateDir, "config.json");

    // Read repoPath from config
    let repoPath: string | null = null;
    if (existsSync(configPath)) {
      try {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        if (typeof raw.repoPath === "string") {
          repoPath = raw.repoPath;
        }
      } catch {
        // Corrupt config — skip repoPath
      }
    }

    const pathExists = repoPath !== null && existsSync(repoPath);

    // Count pipeline entries
    const countDirEntries = (dir: string, flatOnly: boolean): number => {
      if (!existsSync(dir)) return 0;
      try {
        const items = readdirSync(dir, { withFileTypes: true });
        if (flatOnly) {
          return items.filter((i) => i.isFile() && i.name.endsWith(".md"))
            .length;
        }
        return items.filter((i) => i.isDirectory()).length;
      } catch {
        return 0;
      }
    };

    const pipelineDir = join(stateDir, "pipeline");
    const backlogCount = countDirEntries(join(pipelineDir, "backlog"), true);
    const inProgressCount = countDirEntries(
      join(pipelineDir, "in-progress"),
      false,
    );
    const completedCount = countDirEntries(join(pipelineDir, "out"), false);

    repos.push({
      id,
      repoPath,
      pathExists,
      backlogCount,
      inProgressCount,
      completedCount,
    });
  }

  return repos;
}

/**
 * Look up a repo by name or path. Tries to match the given identifier
 * against known repo IDs (exact or suffix match) and stored repo paths.
 * Returns the repo state dir path if found, or null.
 */
export function resolveRepoByNameOrPath(
  nameOrPath: string,
  env?: Record<string, string | undefined>,
): string | null {
  const repos = listAllRepos(env);

  // 1. Exact ID match
  const exact = repos.find((r) => r.id === nameOrPath);
  if (exact) return join(getRalphaiHome(env), "repos", exact.id);

  // 2. Suffix match (e.g., "ralphai" matches "github-com-mfaux-ralphai")
  const suffix = repos.filter((r) => r.id.endsWith(`-${nameOrPath}`));
  if (suffix.length === 1) {
    return join(getRalphaiHome(env), "repos", suffix[0]!.id);
  }

  // 3. Repo path match
  const resolvedInput = resolvePath(nameOrPath);
  const byPath = repos.find(
    (r) => r.repoPath !== null && resolvePath(r.repoPath) === resolvedInput,
  );
  if (byPath) return join(getRalphaiHome(env), "repos", byPath.id);

  return null;
}

/**
 * Remove stale repo entries from global state.
 *
 * A repo is considered stale when its stored `repoPath` points to a directory
 * that no longer exists **and** its pipeline is completely empty (no backlog,
 * in-progress, or completed plans). Returns the IDs of removed entries.
 */
export function removeStaleRepos(
  env?: Record<string, string | undefined>,
): string[] {
  const repos = listAllRepos(env);
  const reposDir = join(getRalphaiHome(env), "repos");
  const removed: string[] = [];

  for (const repo of repos) {
    const isStale =
      repo.repoPath !== null &&
      !repo.pathExists &&
      repo.backlogCount === 0 &&
      repo.inProgressCount === 0 &&
      repo.completedCount === 0;

    if (isStale) {
      const stateDir = join(reposDir, repo.id);
      rmSync(stateDir, { recursive: true, force: true });
      removed.push(repo.id);
    }
  }

  return removed;
}

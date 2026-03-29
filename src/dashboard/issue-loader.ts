/**
 * Async GitHub issue loader for the dashboard.
 *
 * Fetches open issues with the configured label from the GitHub API via
 * the `gh` CLI. Returns PlanInfo objects with `source: "github-remote"`
 * that represent issues not yet pulled into the local pipeline.
 *
 * Designed for periodic polling at a longer interval (30s) than local
 * plan loading (3s) to avoid GitHub API rate-limiting.
 */

import { exec } from "node:child_process";
import { join } from "path";
import { parseConfigFile, getConfigFilePath } from "../config.ts";
import { detectIssueRepo, slugify } from "../issues.ts";
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise-based exec with string result. */
function execAsync(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, encoding: "utf-8", timeout: 15_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

/** Load issue-related config values for a repo. */
function loadIssueConfig(cwd: string): {
  issueSource: string;
  issueLabel: string;
  issueRepo: string;
} | null {
  try {
    const configPath = getConfigFilePath(cwd);
    const parsed = parseConfigFile(configPath);
    if (!parsed) return null;
    return {
      issueSource: (parsed.values.issueSource as string | undefined) ?? "none",
      issueLabel: (parsed.values.issueLabel as string | undefined) ?? "ralphai",
      issueRepo: (parsed.values.issueRepo as string | undefined) ?? "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Fetch open GitHub issues with the configured label and return them as
 * PlanInfo objects with `source: "github-remote"`.
 *
 * Deduplicates against `localPlans`: issues whose number matches an
 * existing plan's `issueNumber` are excluded.
 *
 * Returns an empty array when:
 * - `issueSource` is not "github" in config
 * - `gh` CLI is not available or not authenticated
 * - The GitHub repo cannot be detected
 * - The API call fails
 */
export async function loadGithubIssuesAsync(
  cwd: string,
  localPlans: PlanInfo[],
): Promise<PlanInfo[]> {
  const config = loadIssueConfig(cwd);
  if (!config || config.issueSource !== "github") return [];

  // Verify gh is authenticated (fast check).
  try {
    await execAsync("gh auth status", cwd);
  } catch {
    return [];
  }

  const repo = detectIssueRepo(cwd, config.issueRepo);
  if (!repo) return [];

  // Fetch open issues with the configured label.
  let raw: string;
  try {
    raw = await execAsync(
      `gh issue list --repo "${repo}" --label "${config.issueLabel}"` +
        ` --state open --limit 100 --json number,title,url`,
      cwd,
    );
  } catch {
    return [];
  }

  let issues: Array<{ number: number; title: string; url: string }>;
  try {
    issues = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(issues) || issues.length === 0) return [];

  // Build a set of issue numbers already present locally.
  const localIssueNumbers = new Set(
    localPlans
      .filter((p) => p.issueNumber !== undefined)
      .map((p) => p.issueNumber),
  );

  return issues
    .filter((issue) => !localIssueNumbers.has(issue.number))
    .map((issue) => {
      const slug = `gh-${issue.number}-${slugify(issue.title)}`;
      return {
        filename: `${slug}.md`,
        slug,
        state: "backlog" as const,
        source: "github-remote" as const,
        issueNumber: issue.number,
        issueUrl: issue.url,
      };
    });
}

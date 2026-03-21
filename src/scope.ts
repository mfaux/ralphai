import { existsSync, readFileSync } from "fs";
import { join } from "path";

import {
  type DetectedPM,
  detectProject,
  detectPackageManager,
  deriveScopedFeedback,
  deriveDotnetScopedFeedback,
} from "./project-detection.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolveScopeInput {
  /** Repository root directory. */
  cwd: string;
  /** Relative path to the scoped package directory (e.g. "packages/web"). */
  planScope: string;
  /** Root-level feedback commands (comma-separated string). */
  rootFeedbackCommands: string;
  /** Workspace config JSON (stringified object keyed by scope path). */
  workspacesConfig?: string;
}

export interface ResolveScopeResult {
  ecosystem: string;
  packageManager: string;
  feedbackCommands: string;
  scopeHint: string;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Resolve scoped feedback commands for a monorepo workspace package.
 *
 * Combines ecosystem detection, package manager detection, and feedback
 * command rewriting into a single call. This is the TypeScript equivalent
 * of the shell's `resolve_scoped_feedback()` + `build_scope_hint()`.
 */
export function resolveScope(input: ResolveScopeInput): ResolveScopeResult {
  const { cwd, planScope, rootFeedbackCommands, workspacesConfig } = input;

  // No scope means pass everything through unchanged.
  if (!planScope) {
    return {
      ecosystem: detectProject(cwd)?.ecosystem ?? "unknown",
      packageManager: "",
      feedbackCommands: rootFeedbackCommands,
      scopeHint: "",
    };
  }

  // Detect ecosystem
  const project = detectProject(cwd);
  const ecosystem = project?.ecosystem ?? "unknown";

  // Check for workspace-specific feedbackCommands override
  if (workspacesConfig) {
    try {
      const config = JSON.parse(workspacesConfig);
      const wsEntry = config[planScope];
      if (wsEntry?.feedbackCommands) {
        const fc = Array.isArray(wsEntry.feedbackCommands)
          ? wsEntry.feedbackCommands.join(",")
          : wsEntry.feedbackCommands;
        return {
          ecosystem,
          packageManager: "",
          feedbackCommands: fc,
          scopeHint: buildScopeHint(planScope),
        };
      }
    } catch {
      // Invalid JSON — fall through to auto-detection
    }
  }

  // No root feedback commands means nothing to rewrite
  if (!rootFeedbackCommands) {
    return {
      ecosystem,
      packageManager: "",
      feedbackCommands: "",
      scopeHint: buildScopeHint(planScope),
    };
  }

  // Only node and dotnet ecosystems support scoped feedback
  if (ecosystem !== "node" && ecosystem !== "dotnet") {
    return {
      ecosystem,
      packageManager: "",
      feedbackCommands: rootFeedbackCommands,
      scopeHint: buildScopeHint(planScope),
    };
  }

  const rootCommands = rootFeedbackCommands
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  let pm: DetectedPM | null = null;
  let packageName = "";
  let rewritten: string[];

  if (ecosystem === "node") {
    // Read the scoped package's name from its package.json
    const pkgJsonPath = join(cwd, planScope, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (typeof pkg.name === "string") {
          packageName = pkg.name;
        }
      } catch {
        // Fall through — no package name
      }
    }

    pm = detectPackageManager(cwd);

    if (pm && packageName) {
      // Rewrite node commands via PM workspace filters, then also handle
      // any dotnet commands that may have been merged from a mixed repo.
      rewritten = deriveScopedFeedback(pm, rootCommands, packageName);
      rewritten = deriveDotnetScopedFeedback(rewritten, planScope);
    } else {
      // No package name (e.g. .NET sub-project in mixed repo) — only
      // rewrite dotnet commands.
      rewritten = deriveDotnetScopedFeedback(rootCommands, planScope);
    }
  } else {
    // Pure dotnet ecosystem
    rewritten = deriveDotnetScopedFeedback(rootCommands, planScope);
  }

  return {
    ecosystem,
    packageManager: pm?.manager ?? "",
    feedbackCommands: rewritten.join(","),
    scopeHint: buildScopeHint(planScope),
  };
}

function buildScopeHint(planScope: string): string {
  if (!planScope) return "";
  return `\nThis plan is scoped to ${planScope}. Focus your changes on files within this directory. Run feedback commands from the repository root — they are already filtered to target this package.`;
}

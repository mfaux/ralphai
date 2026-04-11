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
  /** Root-level PR-tier feedback commands (comma-separated string). */
  rootPrFeedbackCommands: string;
  /** Root-level validator commands (comma-separated string). */
  rootValidators?: string;
  /** Workspace config JSON (stringified object keyed by scope path). */
  workspacesConfig?: string;
  /** Root-level beforeRun hook command. */
  rootBeforeRun?: string;
  /** Root-level preamble (already resolved from config). */
  rootPreamble?: string;
}

export interface ResolveScopeResult {
  ecosystem: string;
  packageManager: string;
  feedbackCommands: string;
  prFeedbackCommands: string;
  validators: string;
  scopeHint: string;
  /** Per-workspace beforeRun override (undefined = use root value). */
  beforeRun?: string;
  /** Per-workspace preamble override (undefined = use root value). */
  preamble?: string;
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
  const {
    cwd,
    planScope,
    rootFeedbackCommands,
    rootPrFeedbackCommands,
    rootValidators = "",
    workspacesConfig,
    rootBeforeRun,
    rootPreamble,
  } = input;

  // No scope means pass everything through unchanged.
  if (!planScope) {
    return {
      ecosystem: detectProject(cwd)?.ecosystem ?? "unknown",
      packageManager: "",
      feedbackCommands: rootFeedbackCommands,
      prFeedbackCommands: rootPrFeedbackCommands,
      validators: rootValidators,
      scopeHint: "",
    };
  }

  // Detect ecosystem
  const project = detectProject(cwd);
  const ecosystem = project?.ecosystem ?? "unknown";

  // Extract workspace-level beforeRun and preamble overrides (if any).
  let wsBeforeRun: string | undefined;
  let wsPreamble: string | undefined;

  // Check for workspace-specific overrides
  if (workspacesConfig) {
    try {
      const config = JSON.parse(workspacesConfig);
      const wsEntry = config[planScope];

      // Capture beforeRun override from workspace config.
      if (wsEntry && typeof wsEntry.beforeRun === "string") {
        wsBeforeRun = wsEntry.beforeRun;
      }

      // Capture preamble override from workspace config.
      if (wsEntry && typeof wsEntry.preamble === "string") {
        wsPreamble = wsEntry.preamble;
      }

      if (wsEntry?.feedbackCommands) {
        const fc = Array.isArray(wsEntry.feedbackCommands)
          ? wsEntry.feedbackCommands.join(",")
          : wsEntry.feedbackCommands;
        // Use workspace prFeedbackCommands override if present, otherwise
        // pass through the root value.
        const pfc = wsEntry.prFeedbackCommands
          ? Array.isArray(wsEntry.prFeedbackCommands)
            ? wsEntry.prFeedbackCommands.join(",")
            : wsEntry.prFeedbackCommands
          : rootPrFeedbackCommands;
        // Use workspace validators override if present, otherwise
        // pass through the root value.
        const val = wsEntry.validators
          ? Array.isArray(wsEntry.validators)
            ? wsEntry.validators.join(",")
            : wsEntry.validators
          : rootValidators;
        return {
          ecosystem,
          packageManager: "",
          feedbackCommands: fc,
          prFeedbackCommands: pfc,
          validators: val,
          beforeRun: wsBeforeRun ?? rootBeforeRun,
          preamble: wsPreamble ?? rootPreamble,
          scopeHint: buildScopeHint(planScope),
        };
      }
    } catch {
      // Invalid JSON — fall through to auto-detection
    }
  }

  // Only node and dotnet ecosystems support scoped feedback
  if (ecosystem !== "node" && ecosystem !== "dotnet") {
    return {
      ecosystem,
      packageManager: "",
      feedbackCommands: rootFeedbackCommands,
      prFeedbackCommands: rootPrFeedbackCommands,
      validators: rootValidators,
      beforeRun: wsBeforeRun ?? rootBeforeRun,
      preamble: wsPreamble ?? rootPreamble,
      scopeHint: buildScopeHint(planScope),
    };
  }

  // No root feedback commands AND no root PR commands — nothing to rewrite
  if (!rootFeedbackCommands && !rootPrFeedbackCommands) {
    return {
      ecosystem,
      packageManager: "",
      feedbackCommands: "",
      prFeedbackCommands: "",
      validators: rootValidators,
      beforeRun: wsBeforeRun ?? rootBeforeRun,
      preamble: wsPreamble ?? rootPreamble,
      scopeHint: buildScopeHint(planScope),
    };
  }

  // Detect PM and package name (shared by both loop-tier and PR-tier rewriting)
  let pm: DetectedPM | null = null;
  let packageName = "";

  if (ecosystem === "node") {
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
  }

  // Helper to rewrite a comma-separated command string using the detected
  // PM / package name / ecosystem.
  const rewrite = (raw: string): string => {
    if (!raw) return "";
    const cmds = raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    let result: string[];
    if (ecosystem === "node" && pm && packageName) {
      result = deriveScopedFeedback(pm, cmds, packageName);
      result = deriveDotnetScopedFeedback(result, planScope);
    } else {
      result = deriveDotnetScopedFeedback(cmds, planScope);
    }
    return result.join(",");
  };

  return {
    ecosystem,
    packageManager: pm?.manager ?? "",
    feedbackCommands: rewrite(rootFeedbackCommands),
    prFeedbackCommands: rewrite(rootPrFeedbackCommands),
    validators: rootValidators,
    beforeRun: wsBeforeRun ?? rootBeforeRun,
    preamble: wsPreamble ?? rootPreamble,
    scopeHint: buildScopeHint(planScope),
  };
}

function buildScopeHint(planScope: string): string {
  if (!planScope) return "";
  return `\nThis plan is scoped to ${planScope}. Focus your changes on files within this directory. Run feedback commands from the repository root — they are already filtered to target this package.`;
}

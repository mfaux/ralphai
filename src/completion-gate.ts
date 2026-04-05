/**
 * Completion gate: independent verification that runs when the agent
 * claims COMPLETE. Checks two things:
 *
 * 1. **Task count** — progress file shows at least as many completed
 *    tasks as the plan declares. Skipped when totalTasks is 0.
 * 2. **Feedback commands** — each configured feedback command exits 0.
 *    Skipped when feedbackCommands is empty.
 *
 * If either check fails, the gate returns a rejection with a reason
 * string. The runner uses this to re-invoke the agent instead of
 * archiving the plan.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";

import {
  countCompletedFromProgress,
  type PlanFormat,
} from "./plan-detection.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for the pure gate check (no I/O). */
export interface CompletionGateInput {
  /** Number of completed tasks found in progress file. */
  completedTasks: number;
  /** Total tasks declared in the plan. */
  totalTasks: number;
  /** Results of running each feedback command. */
  feedbackResults: FeedbackResult[];
}

/** Result of running a single feedback command. */
export interface FeedbackResult {
  command: string;
  exitCode: number;
  /** Truncated stderr/stdout on failure (for logging). */
  output: string;
}

/** Outcome of the completion gate. */
export type GateOutcome =
  | { passed: true }
  | { passed: false; reason: string; details: string[] };

// ---------------------------------------------------------------------------
// Pure gate logic (no I/O — testable)
// ---------------------------------------------------------------------------

/**
 * Evaluate the completion gate from pre-gathered inputs.
 *
 * Returns a pass/fail outcome. On failure, `reason` is a short summary
 * and `details` contains per-check diagnostic lines.
 */
export function checkCompletionGate(input: CompletionGateInput): GateOutcome {
  const details: string[] = [];

  // --- Task count check ---
  if (input.totalTasks > 0 && input.completedTasks < input.totalTasks) {
    details.push(
      `Task count: ${input.completedTasks}/${input.totalTasks} tasks completed in progress file.`,
    );
  }

  // --- Feedback command check ---
  for (const result of input.feedbackResults) {
    if (result.exitCode !== 0) {
      const snippet = result.output ? `: ${result.output.slice(0, 200)}` : "";
      details.push(
        `Feedback command failed (exit ${result.exitCode}): ${result.command}${snippet}`,
      );
    }
  }

  if (details.length > 0) {
    const reasons: string[] = [];
    if (input.totalTasks > 0 && input.completedTasks < input.totalTasks) {
      reasons.push("incomplete tasks");
    }
    const failedCmds = input.feedbackResults.filter((r) => r.exitCode !== 0);
    if (failedCmds.length > 0) {
      reasons.push("failing feedback commands");
    }
    return {
      passed: false,
      reason: `Completion gate rejected: ${reasons.join(" and ")}.`,
      details,
    };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Side-effecting helpers (I/O)
// ---------------------------------------------------------------------------

/**
 * Run feedback commands and collect results.
 *
 * Each command is run independently (not short-circuited) so we report
 * all failures, not just the first.
 */
export function runFeedbackCommands(
  feedbackCommands: string,
  cwd: string,
): FeedbackResult[] {
  if (!feedbackCommands.trim()) return [];

  const commands = feedbackCommands
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  return commands.map((command) => {
    try {
      execSync(command, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000, // 2 minute timeout per command
      });
      return { command, exitCode: 0, output: "" };
    } catch (err: unknown) {
      const exitCode =
        err && typeof err === "object" && "status" in err
          ? ((err as { status: number }).status ?? 1)
          : 1;
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr).trim()
          : "";
      const stdout =
        err && typeof err === "object" && "stdout" in err
          ? String((err as { stdout: unknown }).stdout).trim()
          : "";
      return {
        command,
        exitCode,
        output: stderr || stdout,
      };
    }
  });
}

/**
 * Read the progress file and count completed tasks.
 *
 * Returns 0 if the file doesn't exist.
 */
export function readCompletedTasks(
  progressFile: string,
  planFormat: PlanFormat,
): number {
  if (!existsSync(progressFile)) return 0;
  const content = readFileSync(progressFile, "utf-8");
  return countCompletedFromProgress(content, planFormat);
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/** Options for the full gate check (reads files, runs commands). */
export interface RunCompletionGateOptions {
  /** Path to the progress file. */
  progressFile: string;
  /** Detected plan format. */
  planFormat: PlanFormat;
  /** Total tasks from the plan. */
  totalTasks: number;
  /** Comma-separated feedback commands. */
  feedbackCommands: string;
  /** Working directory for running feedback commands. */
  cwd: string;
}

/**
 * Run the full completion gate: read progress, run feedback commands,
 * and evaluate.
 *
 * This is the main entry point called from the runner loop.
 */
export function runCompletionGate(
  options: RunCompletionGateOptions,
): GateOutcome {
  const completedTasks = readCompletedTasks(
    options.progressFile,
    options.planFormat,
  );

  const feedbackResults = runFeedbackCommands(
    options.feedbackCommands,
    options.cwd,
  );

  return checkCompletionGate({
    completedTasks,
    totalTasks: options.totalTasks,
    feedbackResults,
  });
}

/**
 * Format a gate rejection into a context string that can be prepended
 * to the next agent prompt, so the agent knows why COMPLETE was rejected.
 */
export function formatGateRejection(outcome: GateOutcome): string {
  if (outcome.passed) return "";
  const lines = [
    "IMPORTANT: Your previous COMPLETE signal was rejected by the completion gate.",
    outcome.reason,
    "",
    "Details:",
    ...outcome.details.map((d) => `  - ${d}`),
    "",
    "Fix the issues above and try again. Do NOT output <promise>COMPLETE</promise> until all tasks are finished and all feedback commands pass.",
  ];
  return lines.join("\n");
}

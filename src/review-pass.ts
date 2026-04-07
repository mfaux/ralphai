/**
 * Review pass: behavior-preserving simplification after plan completion.
 *
 * After the agent completes a plan and passes the completion gate, this
 * module drives a one-shot review pass that looks at the changed files
 * and asks the agent to perform behavior-preserving simplifications
 * (dead code removal, redundant logic, etc.).
 *
 * Follows the pure/impure split established by `completion-gate.ts`:
 * - Pure functions: `assembleReviewPrompt` (prompt assembly, file capping)
 * - Side-effecting: `getChangedFiles` (git operations), `runReviewPass` (orchestration)
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

import { execQuiet } from "./exec.ts";
import { spawnAgent } from "./runner.ts";
import type { IpcMessage } from "./ipc-protocol.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of files to include in the review prompt. */
export const MAX_FILES_IN_PROMPT = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for assembling the review prompt (pure — no I/O). */
export interface AssembleReviewPromptOptions {
  /** Relative paths of changed files to review. */
  files: string[];
  /** The feedback step for the agent to verify changes (wrapper path or raw commands). */
  feedbackStep: string;
}

/** Options for running the full review pass (side-effecting). */
export interface RunReviewPassOptions {
  /** The base branch to diff against. */
  baseBranch: string;
  /** The agent command to invoke. */
  agentCommand: string;
  /** The feedback step for the agent to verify changes. */
  feedbackStep: string;
  /** Timeout in seconds for the agent iteration. */
  iterationTimeout: number;
  /** Working directory (worktree root). */
  cwd: string;
  /** Optional path to write agent output logs. */
  outputLogPath?: string;
  /** Optional IPC broadcast callback. */
  ipcBroadcast?: (msg: IpcMessage) => void;
}

/** Result of a review pass. */
export interface ReviewPassResult {
  /** Whether the agent made any commits during the review pass. */
  madeChanges: boolean;
  /** The agent's output text. */
  output: string;
}

// ---------------------------------------------------------------------------
// Side-effecting: git operations
// ---------------------------------------------------------------------------

/**
 * Get the list of files changed between the base branch and HEAD.
 *
 * Runs `git diff --name-only <baseBranch>...HEAD` and filters out files
 * that no longer exist on disk (deletions). Returns relative paths.
 */
export function getChangedFiles(baseBranch: string, cwd: string): string[] {
  const output = execQuiet(`git diff --name-only ${baseBranch}...HEAD`, cwd);

  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => existsSync(join(cwd, file)));
}

// ---------------------------------------------------------------------------
// Pure: prompt assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the review prompt from a file list and feedback step.
 *
 * This is a one-shot utility prompt with NO sentinel tags (no learnings,
 * progress, or promise blocks). The prompt instructs the agent to:
 * - Look only at the listed files
 * - Perform behavior-preserving simplifications
 * - Make no changes if the code is already clean
 * - Not scan the rest of the repo
 * - Run feedback commands to verify changes
 * - Commit with a conventional commit message
 *
 * Caps the file list at 25 entries with an overflow note.
 */
export function assembleReviewPrompt(
  options: AssembleReviewPromptOptions,
): string {
  const { files, feedbackStep } = options;

  const displayFiles = files.slice(0, MAX_FILES_IN_PROMPT);
  const fileList = displayFiles.map((f) => `- ${f}`).join("\n");
  const overflowNote =
    files.length > MAX_FILES_IN_PROMPT
      ? `\n(... and ${files.length - MAX_FILES_IN_PROMPT} more files not listed — focus on the files above.)\n`
      : "";

  const lines = [
    "You are performing a review pass on the following changed files.",
    "Your goal is behavior-preserving simplification. Do NOT change any observable behavior.",
    "",
    "## Changed files",
    "",
    fileList,
    overflowNote,
    "## Instructions",
    "",
    "Look ONLY at the files listed above. Do not scan the rest of the repo.",
    "",
    "Perform behavior-preserving simplifications where you find opportunities:",
    "- Remove dead code (unreachable branches, unused functions)",
    "- Eliminate redundant logic (duplicate conditions, unnecessary checks)",
    "- Remove unnecessary abstractions (over-engineered wrappers, pointless indirection)",
    "- Remove duplicate code (copy-pasted blocks that can be unified)",
    "- Remove unused variables and imports",
    "- Simplify overly complex control flow",
    "",
    "If the code is already clean and no simplifications are warranted, make no changes at all.",
    "",
    "## Verification",
    "",
    `After making changes, run the feedback commands to verify nothing is broken:`,
    `\`${feedbackStep}\``,
    "",
    "## Commit",
    "",
    "If you made changes, commit them with a conventional commit message using the `refactor:` prefix.",
    "Example: `refactor: simplify error handling in validation module`",
    "",
    "If you made no changes, do not create any commits.",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Side-effecting: orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full review pass: detect changed files, assemble the prompt,
 * invoke the agent, and detect whether changes were made.
 *
 * Short-circuits if no files have changed. Change detection uses
 * `git rev-parse HEAD` before and after the agent invocation.
 */
export async function runReviewPass(
  options: RunReviewPassOptions,
): Promise<ReviewPassResult> {
  const {
    baseBranch,
    agentCommand,
    feedbackStep,
    iterationTimeout,
    cwd,
    outputLogPath,
    ipcBroadcast,
  } = options;

  // 1. Detect changed files
  const files = getChangedFiles(baseBranch, cwd);
  if (files.length === 0) {
    return { madeChanges: false, output: "" };
  }

  // 2. Assemble the prompt
  const prompt = assembleReviewPrompt({ files, feedbackStep });

  // 3. Record HEAD before agent invocation
  const headBefore = execQuiet("git rev-parse HEAD", cwd);

  // 4. Write review pass header to agent output log
  if (outputLogPath) {
    try {
      writeFileSync(outputLogPath, "\n--- Review Pass ---\n", { flag: "a" });
    } catch {
      // Best-effort; non-fatal if we can't write the header
    }
  }

  // 5. Invoke the agent
  const { output } = await spawnAgent(
    agentCommand,
    prompt,
    iterationTimeout,
    cwd,
    outputLogPath,
    ipcBroadcast,
  );

  // 6. Compare HEAD after agent invocation
  const headAfter = execQuiet("git rev-parse HEAD", cwd);
  const madeChanges = headBefore !== headAfter;

  return { madeChanges, output };
}

/**
 * Prompt assembly: formats file references and builds the full agent
 * prompt string for each iteration of the runner loop.
 *
 * All file references are inlined (file content embedded in `<file>` XML
 * tags). Progress is reported via structured `<progress>` output blocks
 * in agent stdout, not by agents writing to the filesystem directly.
 * The runner extracts these blocks and appends them to the global
 * progress file.
 */
import { existsSync, readFileSync } from "fs";
import type { PlanFormat } from "./plan-detection.ts";
import { formatLearningsForPrompt } from "./learnings.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for assembling the full agent prompt. */
export interface AssemblePromptOptions {
  /** Plan file path (relative to repo root). */
  planFile: string;
  /** Progress file path (relative to repo root). */
  progressFile: string;
  /** Comma-separated feedback commands (may be empty). */
  feedbackCommands: string;
  /** Monorepo scope hint (may be empty). */
  scopeHint: string;
  /** Accumulated learnings from prior iterations (in-memory). */
  learnings: string[];
  /** Detected plan format — drives prompt wording for step 2 and progress blocks. */
  planFormat?: PlanFormat;
}

// ---------------------------------------------------------------------------
// formatFileRef
// ---------------------------------------------------------------------------

/**
 * Format a file reference for the agent prompt.
 *
 * Reads the file and wraps contents in `<file path="...">...</file>` XML
 * tags. Uses the provided `label` (if given) instead of the raw filesystem
 * path so that agents running inside a sandbox never see absolute paths
 * outside the repository and do not attempt to re-read them.
 *
 * Falls back to an inline placeholder block if the file does not exist.
 */
export function formatFileRef(filepath: string, label?: string): string {
  const tag = label ?? filepath;
  if (existsSync(filepath)) {
    const content = readFileSync(filepath, "utf8");
    return `<file path="${tag}">\n${content}\n</file>`;
  }
  return `<file path="${tag}">\n(No content yet.)\n</file>`;
}

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

/**
 * Build the full agent prompt for a single iteration.
 *
 * Always assumes Ralphai runs in an isolated worktree branch and commits.
 */
export function assemblePrompt(options: AssemblePromptOptions): string {
  const {
    planFile,
    progressFile,
    feedbackCommands,
    scopeHint,
    learnings,
    planFormat = "tasks",
  } = options;

  const isCheckboxes = planFormat === "checkboxes";

  // Use short labels instead of absolute paths so sandboxed agents never
  // see external filesystem paths and don't try to re-read/write them.
  const planLabel = "plan.md";
  const progressLabel = "progress.md";

  const planRef = formatFileRef(planFile, planLabel);
  const progressRef = formatFileRef(progressFile, progressLabel);

  // --- File references header ---
  const fileRefs = ` ${planRef} ${progressRef}`;

  // --- Learnings context (in-memory, not file-based) ---
  const learningsContext = formatLearningsForPrompt(learnings);
  const learningsHint =
    learnings.length > 0
      ? " Apply any relevant learnings from previous iterations included below."
      : "";

  // --- Feedback commands text ---
  const feedbackText = feedbackCommands
    ? feedbackCommands.split(",").join(", ")
    : "";

  // --- Mode-aware instructions ---
  const feedbackStep = feedbackText
    ? `Run all feedback loops: ${feedbackText}. Fix any failures before continuing.`
    : `Run your project's build, test, and lint commands. Fix any failures before continuing.`;

  const commitInstruction =
    "Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish an iteration with uncommitted changes.";

  const completeInstruction =
    "but ONLY after committing. Never output COMPLETE with uncommitted changes.";

  // --- Format-aware step 2 and progress block ---
  const step2 = isCheckboxes
    ? "Pick the next group of unchecked items from the plan that form a coherent commit. You may satisfy multiple related items in one iteration (e.g., related error cases that share implementation)."
    : "Find the highest-priority incomplete task (see prioritization rules in the plan).";

  const completionRef = isCheckboxes
    ? "all items checked"
    : "all tasks complete";

  const progressBlock = isCheckboxes
    ? `REQUIRED: Also include a <progress> block at the very end of your response (after learnings). Use this exact format for the items you completed this iteration:
- [x] <item description>
- [x] <item description>
This format is required — ralphai parses it to track task completion.
If the task was not fully completed this iteration, include a brief summary of partial progress instead.
Example:
<progress>
- [x] Validate input length is within bounds
- [x] Return descriptive error for empty input
</progress>
Ralphai extracts this block and appends it to the progress file automatically. Do NOT write progress.md directly.`
    : `REQUIRED: Also include a <progress> block at the very end of your response (after learnings). Use this exact format for the task you completed this iteration:
### Task N: <title>
**Status:** Complete
<summary of what was done, including which subtasks were completed>
This format is required — ralphai parses it to track task completion.
If the task was not fully completed this iteration, include a brief summary of partial progress instead.
Example:
<progress>
### Task 3: Add validation
**Status:** Complete
Implemented input validation (3.1), error messages (3.2), and updated tests (3.3).
</progress>
Ralphai extracts this block and appends it to the progress file automatically. Do NOT write progress.md directly.`;

  // --- Learnings context section (injected before instructions when non-empty) ---
  const learningsSection =
    learningsContext.length > 0 ? `\n${learningsContext}\n` : "";

  // --- Assemble the prompt ---
  return `${fileRefs}${scopeHint}${learningsSection}
1. Review the plan and progress content provided above (already inlined — do NOT attempt to read plan.md or progress.md from disk; they do not exist in the worktree).${learningsHint}
2. ${step2}
3. Implement it with small, focused changes. Testing strategy depends on task type:
   - Bug fix: Write a failing test FIRST that reproduces the bug, then fix the code to make it pass.
   - New feature: Implement the feature, then add tests that cover the new code.
   - Refactor: Verify existing tests pass before and after. Only add tests if you discover coverage gaps.
4. ${feedbackStep}
5. Documentation: Review whether your changes affect any documentation. Update these files if they are outdated or incomplete:
   - README.md (commands, usage, feature descriptions)
   - AGENTS.md — only if your work created knowledge that future coding agents need and cannot easily infer from the code (e.g. new CLI commands, non-obvious architectural constraints, changed dev workflows). Routine bug fixes, internal refactors, and new tests do not warrant an AGENTS.md update.
   - Project documentation files that describe architecture, conventions, agent instructions, or reusable skills — update only if your changes affect them.
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.
6. ${commitInstruction}
Complete ONLY the task identified in step 2. Finish it fully (including all its subtasks), then end your response. Do not continue to the next task — you will be re-invoked with updated progress to continue. Ralphai manages the iteration loop, so do not attempt to complete the entire plan in one pass.
If ${completionRef}, output <promise>COMPLETE</promise> — ${completeInstruction}
When you output COMPLETE, also include a <pr-summary> block containing a 1-3 sentence plain-language description of what this PR accomplishes. Write it for a human reviewer — explain the purpose and impact, not a list of commits. Example:
<pr-summary>
Add JWT-based authentication with login/logout endpoints, replacing the previous cookie-based session system. Includes rate limiting on auth routes and automatic token refresh.
</pr-summary>
REQUIRED: At the very end of your response, include a <learnings> block. If you made a mistake or learned something this iteration, write a durable, generalizable lesson as freeform prose — something worth considering for AGENTS.md. Do not log one-off typos or dead ends. Use:
<learnings>
Your freeform prose lesson here.
</learnings>
If no learnings this iteration, use:
<learnings>none</learnings>
The <learnings> block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.
${progressBlock}`;
}

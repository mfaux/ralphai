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
  /** Path to LEARNINGS.md (in global state; checked for existence). */
  learningsFile: string;
  /** Path to LEARNING_CANDIDATES.md (in global state). */
  learningCandidatesFile: string;
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
 * Falls back to `@<label>` if the file does not exist.
 */
export function formatFileRef(filepath: string, label?: string): string {
  const tag = label ?? filepath;
  if (existsSync(filepath)) {
    const content = readFileSync(filepath, "utf8");
    return `<file path="${tag}">\n${content}\n</file>`;
  }
  // File doesn't exist — fall back to at-path reference
  return `@${tag}`;
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
    learningsFile,
    learningCandidatesFile,
    planFormat = "tasks",
  } = options;

  const isCheckboxes = planFormat === "checkboxes";

  // Use short labels instead of absolute paths so sandboxed agents never
  // see external filesystem paths and don't try to re-read/write them.
  const planLabel = "plan.md";
  const progressLabel = "progress.md";
  const learningsLabel = "LEARNINGS.md";
  const learningCandidatesLabel = "LEARNING_CANDIDATES.md";

  const planRef = formatFileRef(planFile, planLabel);
  const progressRef = formatFileRef(progressFile, progressLabel);
  const hasLearnings = existsSync(learningsFile);

  // --- File references header ---
  let fileRefs = ` ${planRef} ${progressRef}`;
  let learningsHint = "";
  let learningsStep = "";

  if (hasLearnings) {
    const learningsRef = formatFileRef(learningsFile, learningsLabel);
    fileRefs += ` ${learningsRef}`;
    learningsHint =
      ` Also read ${learningsLabel} as a rolling anti-repeat memory.` +
      ` Apply durable lessons, but do not overfit to stale or overly specific anecdotes.`;
    learningsStep = buildLearningsStep(learningsLabel, learningCandidatesLabel);
  }

  // --- Feedback commands text ---
  const feedbackText = feedbackCommands
    ? feedbackCommands.split(",").join(", ")
    : "";

  // --- Step numbering (shifts when learnings steps are present) ---
  // Without learnings: steps 1-5 (core) + 6 (commit)
  // With learnings: steps 1-5 (core) + 6-9 (learnings) + 10 (commit)
  const commitStepNum = hasLearnings ? "10" : "6";

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

  // --- Assemble the prompt ---
  return `${fileRefs}${scopeHint}
1. Read the referenced files and the progress file.${learningsHint}
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
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.${learningsStep}
${commitStepNum}. ${commitInstruction}
Work on the next incomplete task. Complete it fully (including all its subtasks) before ending your response.
If ${completionRef}, output <promise>COMPLETE</promise> — ${completeInstruction}
REQUIRED: At the very end of your response, include a <learnings> block. If you made a mistake or learned something this iteration, use:
<learnings>
<entry>
status: logged
date: YYYY-MM-DD
title: Short description
what: What went wrong
root_cause: Why it happened
prevention: How to avoid it
</entry>
</learnings>
If no learnings this iteration, use:
<learnings>
<entry>
status: none
</entry>
</learnings>
The <learnings> block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.
${progressBlock}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the learnings instruction steps (steps 6-9 when learnings exist).
 */
function buildLearningsStep(
  learningsFile: string,
  learningCandidatesFile: string,
): string {
  return `
6. Read ${learningsFile} before making changes. Treat it as advisory memory, not as ground truth.
   - Apply durable repo and workflow constraints immediately.
   - Prefer general rules over narrow anecdotes.
   - Be cautious with old, task-specific, or overly detailed entries.
   - If multiple entries overlap, follow the shared rule rather than the most specific incident.

7. If you make a mistake, log it via the <learnings> block at the end of your response (see below). Do NOT edit ${learningsFile} directly — ralphai persists logged entries automatically.
   Each entry must include:
   - Date
   - What went wrong
   - Root cause
   - Fix / Prevention

   When writing learnings:
   - Generalize the incident into a reusable rule.
   - Keep the entry concise.
   - Do not log one-off typos, incidental dead ends, or highly specific details unless they reveal a reusable pattern.
   - Do not create duplicate entries; merge or refine an existing entry when the lesson already exists.

8. If a lesson appears durable, repo-specific, or useful beyond the current iteration, do not edit AGENTS.md.
   Instead, note it as a candidate in your <learnings> block for later human review.

9. Never edit AGENTS.md automatically based on learnings or candidates.`;
}

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
import type { PlanFormat } from "./plan-lifecycle.ts";
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
  /**
   * Feedback scope: the common parent directory of files relevant to the plan.
   * Used by downstream prompt wording to narrow feedback focus. May be empty
   * when no scope could be inferred.
   */
  feedbackScope?: string;
  /** Accumulated learnings from prior iterations (in-memory). */
  learnings: string[];
  /** Detected plan format — drives prompt wording for step 2 and progress blocks. */
  planFormat?: PlanFormat;
  /** Completion gate rejection message from the previous iteration (if any). */
  gateRejection?: string;
  /**
   * Per-iteration nonce for sentinel tag authentication. When provided,
   * all sentinel tags in the prompt (`<promise>`, `<learnings>`,
   * `<progress>`, `<pr-summary>`) include a `nonce` attribute. The
   * runner only recognizes tags whose nonce matches, preventing false
   * positives from tool output that happens to contain bare sentinel strings.
   */
  nonce?: string;
  /**
   * Absolute path to the generated feedback wrapper script in the WIP
   * slug directory (e.g. `~/.ralphai/repos/.../in-progress/slug/_ralphai_feedback.sh`).
   * When set, step 4 tells the agent to run the wrapper instead of
   * listing raw commands. When absent (Windows, or wrapper not
   * generated), step 4 falls back to raw commands.
   */
  wrapperPath?: string;
  /**
   * When true, a terse communication instruction is prepended to the
   * prompt, directing the agent to drop filler words, articles,
   * pleasantries, and hedging while keeping technical terms, code, commit
   * messages, and structured XML blocks (`<learnings>`, `<progress>`,
   * `<pr-summary>`) verbatim.
   */
  terse?: boolean;
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
    feedbackScope,
    learnings,
    planFormat = "tasks",
    gateRejection,
    nonce,
    wrapperPath,
    terse = false,
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
  const feedbackStep = wrapperPath
    ? `Run the feedback wrapper: \`${wrapperPath}\`. This script runs all configured feedback commands sequentially. On success it prints a one-line summary per command; on failure it prints the full output so you can diagnose the issue. Fix any failures before continuing.`
    : feedbackText
      ? `Run all feedback loops: ${feedbackText}. Fix any failures before continuing.`
      : `Run your project's build, test, and lint commands. Fix any failures before continuing.`;

  // --- Feedback scope hint ---
  // When a feedbackScope is provided, inject advisory guidance about
  // the plan's focused directory and suggest targeted test commands.
  const feedbackScopeHint = feedbackScope
    ? `\n   **Scope hint:** This plan's changes are focused in \`${feedbackScope}/\`. For faster iteration, you can run targeted tests (e.g. \`bun test ${feedbackScope}/\`) while developing. Always run the full feedback suite before signaling COMPLETE to ensure nothing outside the scope is broken.`
    : "";

  const commitInstruction =
    "Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish an iteration with uncommitted changes.";

  const completeInstruction =
    "but ONLY after committing. Never output COMPLETE with uncommitted changes.";

  // --- Nonce-stamped sentinel tags ---
  // When a nonce is provided, all sentinel tags include it so the runner
  // can distinguish genuine agent output from tool noise.
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const promiseOpen = `<promise${nonceAttr}>`;
  const promiseClose = "</promise>";
  const learningsOpen = `<learnings${nonceAttr}>`;
  const learningsClose = "</learnings>";
  const progressOpen = `<progress${nonceAttr}>`;
  const progressClose = "</progress>";
  const prSummaryOpen = `<pr-summary${nonceAttr}>`;
  const prSummaryClose = "</pr-summary>";

  // --- Format-aware step 2 and progress block ---
  const step2 = isCheckboxes
    ? "Pick the next group of unchecked items from the plan that form a coherent commit. You may satisfy multiple related items in one iteration (e.g., related error cases that share implementation)."
    : "Find the highest-priority incomplete task (see prioritization rules in the plan). Complete it fully. If the following task is trivially small, continue to it within this iteration.";

  const completionRef = isCheckboxes
    ? "all items checked"
    : "all tasks complete";

  const progressBlock = isCheckboxes
    ? `REQUIRED: Also include a ${progressOpen}...${progressClose} block at the very end of your response (after learnings). Use this exact format for the items you completed this iteration:
- [x] <item description>
- [x] <item description>
This format is required — ralphai parses it to track task completion.
If the task was not fully completed this iteration, include a brief summary of partial progress instead.
Example:
${progressOpen}
- [x] Validate input length is within bounds
- [x] Return descriptive error for empty input
${progressClose}
Ralphai extracts this block and appends it to the progress file automatically. Do NOT write progress.md directly.`
    : `REQUIRED: Also include a ${progressOpen}...${progressClose} block at the very end of your response (after learnings). Use this exact format for the task you completed this iteration:
### Task N: <title>
**Status:** Complete
<summary of what was done, including which subtasks were completed>
This format is required — ralphai parses it to track task completion.
If the task was not fully completed this iteration, include a brief summary of partial progress instead.
Example:
${progressOpen}
### Task 3: Add validation
**Status:** Complete
Implemented input validation (3.1), error messages (3.2), and updated tests (3.3).
${progressClose}
Ralphai extracts this block and appends it to the progress file automatically. Do NOT write progress.md directly.`;

  // --- Learnings context section (injected before instructions when non-empty) ---
  const learningsSection =
    learningsContext.length > 0 ? `\n${learningsContext}\n` : "";

  // --- Gate rejection section (injected prominently when present) ---
  const gateSection = gateRejection
    ? `\n<completion-gate-rejection>\n${gateRejection}\n</completion-gate-rejection>\n`
    : "";

  // --- Terse communication instruction ---
  // When enabled, prepended at the very top of the prompt (before file
  // references) to maximize influence on agent behavior.
  const terseInstruction = terse
    ? `TERSE MODE: Keep all responses concise. Drop articles, filler words, pleasantries, and hedging. Fragments and short synonyms are fine. Keep technical terms, identifiers, and code exactly as-is. Write commit messages, PR summaries, and structured XML blocks (<learnings>, <progress>, <pr-summary>) normally — these are exempt from terse style.\n`
    : "";

  // --- Assemble the prompt ---
  return `${terseInstruction}${fileRefs}${scopeHint}${gateSection}${learningsSection}
1. Review the plan and progress content provided above (already inlined — do NOT attempt to read plan.md or progress.md from disk; they do not exist in the worktree).${learningsHint}
2. ${step2}
3. Implement it with small, focused changes. Testing strategy depends on task type:
   - Bug fix: Write a failing test FIRST that reproduces the bug, then fix the code to make it pass.
   - New feature: Implement the feature, then add tests that cover the new code.
   - Refactor: Verify existing tests pass before and after. Only add tests if you discover coverage gaps.
4. ${feedbackStep}${feedbackScopeHint}
5. Documentation: Review whether your changes affect any documentation. Update these files if they are outdated or incomplete:
   - README.md (commands, usage, feature descriptions)
   - AGENTS.md — only if your work created knowledge that future coding agents need and cannot easily infer from the code (e.g. new CLI commands, non-obvious architectural constraints, changed dev workflows). Routine bug fixes, internal refactors, and new tests do not warrant an AGENTS.md update.
   - Project documentation files that describe architecture, conventions, agent instructions, or reusable skills — update only if your changes affect them.
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.
6. ${commitInstruction}
Complete ONLY the task identified in step 2. Finish it fully (including all its subtasks), then end your response. Do not continue to the next task unless it is trivially small — you will be re-invoked with updated progress to continue. Ralphai manages the iteration loop, so do not attempt to complete the entire plan in one pass.
If ${completionRef}, output ${promiseOpen}COMPLETE${promiseClose} — ${completeInstruction}
IMPORTANT: Ralphai runs an independent completion gate after you output COMPLETE. It verifies that (1) the progress file shows ${completionRef}, and (2) all feedback commands pass when run externally. If the gate rejects, you will be re-invoked to fix the issues. Only claim COMPLETE when you are confident all work is done and all feedback commands pass.
When you output COMPLETE, also include a ${prSummaryOpen}...${prSummaryClose} block containing a 1-3 sentence plain-language description of what this PR accomplishes. Write it for a human reviewer — explain the purpose and impact, not a list of commits. Example:
${prSummaryOpen}
Add JWT-based authentication with login/logout endpoints, replacing the previous cookie-based session system. Includes rate limiting on auth routes and automatic token refresh.
${prSummaryClose}
REQUIRED: At the very end of your response, include a ${learningsOpen}...${learningsClose} block. If you made a mistake or learned something this iteration, write a durable, generalizable lesson as freeform prose — something worth considering for AGENTS.md. Do not log one-off typos or dead ends. When reporting learnings, include specifics that help future iterations hit the ground running:
- File paths modified or discovered (e.g. "the validation logic lives in src/validators/input.ts")
- Exported APIs and their signatures (e.g. "parseConfig(path: string): Config is the main entry point")
- Architecture constraints or patterns observed (e.g. "all DB access goes through the repository layer, never direct queries")
- Error messages encountered and how they were resolved (e.g. "TS2345 type mismatch fixed by narrowing the union with a type guard")
Use:
${learningsOpen}
Your freeform prose lesson here.
${learningsClose}
If no learnings this iteration, use:
${learningsOpen}none${learningsClose}
The ${learningsOpen}...${learningsClose} block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.
${progressBlock}`;
}

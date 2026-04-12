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
import {
  formatLearningsForPrompt,
  formatContextForPrompt,
} from "./learnings.ts";

// ---------------------------------------------------------------------------
// Default preamble
// ---------------------------------------------------------------------------

/**
 * Default preamble injected at the top of the prompt when `prompt.preamble`
 * is empty. Contains TDD strategy and documentation mandate. Replaced
 * entirely when the user sets a non-empty `prompt.preamble`.
 */
export const DEFAULT_PREAMBLE = `**Testing strategy:** Choose your testing approach based on task type:
- Bug fix: Write a failing test FIRST that reproduces the bug, then fix the code to make it pass.
- New feature: Implement the feature, then add tests that cover the new code.
- Refactor: Verify existing tests pass before and after. Only add tests if you discover coverage gaps.

**Documentation mandate:** Review whether your changes affect any documentation. Update relevant docs (README, AGENTS.md, architecture docs) only when they are actually affected — do not rewrite unnecessarily.`;

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
   * When false (default), the prompt includes a terse communication
   * instruction that limits abbreviated style to working commentary
   * (status updates, reasoning notes, conversational replies). Content
   * that persists or is read by humans — documentation files, code
   * comments, commit messages, PR descriptions, error messages, and
   * structured XML blocks — is explicitly required to use normal,
   * grammatical prose.
   *
   * When true, the terse instruction is omitted entirely, allowing
   * the agent to use full, unabridged prose everywhere.
   */
  verbose?: boolean;
  /**
   * User-provided preamble text (already resolved — `@path` references
   * expanded by the runner before passing here). When non-empty, replaces
   * `DEFAULT_PREAMBLE` entirely. When empty or omitted, uses the default.
   */
  preamble?: string;
  /**
   * Agent-specific instructions extracted from the plan's
   * `## Agent Instructions` section. Injected after the preamble and
   * before the file references. May be empty when no section exists.
   */
  agentInstructions?: string;
  /**
   * Whether learnings extraction is enabled. When false, the prompt omits
   * the `<learnings>` block mandate and the warning about missing blocks.
   * Defaults to true.
   */
  enableLearnings?: boolean;
  /**
   * Commit style: "conventional" (default) uses CC-prefix commit
   * instructions; "none" uses a generic commit instruction and plain
   * PR titles.
   */
  commitStyle?: string;
  /**
   * Feedback hint command derived from `hooks.feedback` for the scope
   * hint's targeted test suggestion. When empty, the scope hint falls
   * back to a generic suggestion.
   */
  feedbackHint?: string;
  /**
   * Accumulated context notes from prior iterations (in-memory).
   * Context captures session-scoped notes: code locations, API surfaces,
   * navigation breadcrumbs, and decisions. These are ephemeral and do not
   * persist across plans.
   */
  context?: string[];
  /**
   * Whether context extraction is enabled. When true (default), the prompt
   * includes the `<context>` block mandate and injects any accumulated
   * context notes. When false, context is omitted entirely.
   */
  enableContext?: boolean;
}

// ---------------------------------------------------------------------------
// Agent Instructions extraction
// ---------------------------------------------------------------------------

/**
 * Extract and strip the `## Agent Instructions` section from plan content.
 *
 * Returns `{ instructions, strippedContent }`:
 * - `instructions`: the text under the heading (empty if not found).
 * - `strippedContent`: the plan content with the section removed.
 *
 * The section is delimited by the `## Agent Instructions` heading and the
 * next heading of equal or lesser depth (or end of file).
 */
export function extractAgentInstructions(planContent: string): {
  instructions: string;
  strippedContent: string;
} {
  // Match "## Agent Instructions" at the start of a line (exactly level-2)
  const headingPattern = /^## Agent Instructions[ \t]*$/m;
  const match = headingPattern.exec(planContent);
  if (!match) {
    return { instructions: "", strippedContent: planContent };
  }

  const sectionStart = match.index!;
  const bodyStart = sectionStart + match[0].length;

  // Find the next heading of depth <= 2 (## or #) after the section body
  const rest = planContent.slice(bodyStart);
  const nextHeadingMatch = /^#{1,2}\s/m.exec(rest);
  const sectionEnd = nextHeadingMatch
    ? bodyStart + nextHeadingMatch.index!
    : planContent.length;

  const instructions = planContent.slice(bodyStart, sectionEnd).trim();
  const strippedContent = (
    planContent.slice(0, sectionStart) + planContent.slice(sectionEnd)
  ).replace(/\n{3,}/g, "\n\n");

  return { instructions, strippedContent };
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
    context = [],
    planFormat = "tasks",
    gateRejection,
    nonce,
    wrapperPath,
    verbose = false,
    preamble = "",
    agentInstructions = "",
    enableLearnings = true,
    enableContext = true,
    commitStyle = "conventional",
    feedbackHint = "",
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

  // --- Context notes (in-memory, session-scoped) ---
  const contextContext = enableContext ? formatContextForPrompt(context) : "";
  const contextHint =
    enableContext && context.length > 0
      ? " Review any context notes from previous iterations included below."
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
  // Derives the test command from feedbackHint (hooks.feedback) when
  // available, falling back to a generic suggestion.
  const feedbackScopeHint = feedbackScope
    ? `\n   **Scope hint:** This plan's changes are focused in \`${feedbackScope}/\`. For faster iteration, you can run targeted tests (e.g. \`${feedbackHint || "bun test"} ${feedbackScope}/\`) while developing. Always run the full feedback suite before signaling COMPLETE to ensure nothing outside the scope is broken.`
    : "";

  // --- Commit instruction (depends on commitStyle) ---
  const commitInstruction =
    commitStyle === "conventional"
      ? "Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish an iteration with uncommitted changes."
      : "Stage and commit ALL changes with a clear, descriptive commit message. This is MANDATORY — you must never finish an iteration with uncommitted changes.";

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
  const contextOpen = `<context${nonceAttr}>`;
  const contextClose = "</context>";
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

  // --- Context section (injected before learnings when non-empty and enabled) ---
  const contextSection =
    contextContext.length > 0 ? `\n${contextContext}\n` : "";

  // --- Learnings context section (injected after context when non-empty) ---
  const learningsSection =
    learningsContext.length > 0 ? `\n${learningsContext}\n` : "";

  // --- Gate rejection section (injected prominently when present) ---
  const gateSection = gateRejection
    ? `\n<completion-gate-rejection>\n${gateRejection}\n</completion-gate-rejection>\n`
    : "";

  // --- Terse communication instruction ---
  // Included by default (concise mode). Omitted when verbose is true.
  const terseInstruction = !verbose
    ? `TERSE MODE: Apply concise, abbreviated style ONLY to your working commentary — status updates, reasoning notes, and conversational replies. Drop articles, filler words, pleasantries, and hedging there; fragments and short synonyms are fine. For everything else — code, documentation files, code comments, JSDoc/TSDoc, commit messages, PR descriptions, error messages, and structured XML blocks (<context>, <learnings>, <progress>, <pr-summary>) — use normal, grammatical prose. These are read by humans or persisted in the codebase and must not use terse style. Keep technical terms, identifiers, and code exactly as-is everywhere.\n`
    : "";

  // --- Preamble resolution ---
  // Non-empty user preamble replaces DEFAULT_PREAMBLE entirely.
  const effectivePreamble = preamble || DEFAULT_PREAMBLE;

  // --- Agent instructions section (from plan's ## Agent Instructions) ---
  const agentInstructionsSection = agentInstructions
    ? `\n${agentInstructions}\n`
    : "";

  // --- Assemble the prompt ---
  return `${terseInstruction}${effectivePreamble}
${agentInstructionsSection}${fileRefs}${scopeHint}${gateSection}${contextSection}${learningsSection}
1. Review the plan and progress content provided above (already inlined — do NOT attempt to read plan.md or progress.md from disk; they do not exist in the worktree).${contextHint}${learningsHint}
2. ${step2}
3. Implement it with small, focused changes.
4. ${feedbackStep}${feedbackScopeHint}
5. ${commitInstruction}
Complete ONLY the task identified in step 2. Finish it fully (including all its subtasks), then end your response. Do not continue to the next task unless it is trivially small — you will be re-invoked with updated progress to continue. Ralphai manages the iteration loop, so do not attempt to complete the entire plan in one pass.
If ${completionRef}, output ${promiseOpen}COMPLETE${promiseClose} — ${completeInstruction}
IMPORTANT: Ralphai runs an independent completion gate after you output COMPLETE. It verifies that (1) the progress file shows ${completionRef}, and (2) all feedback commands pass when run externally. If the gate rejects, you will be re-invoked to fix the issues. Only claim COMPLETE when you are confident all work is done and all feedback commands pass.
When you output COMPLETE, also include a ${prSummaryOpen}...${prSummaryClose} block containing a 1-3 sentence plain-language description of what this PR accomplishes. Write it for a human reviewer — explain the purpose and impact, not a list of commits. Example:
${prSummaryOpen}
Add JWT-based authentication with login/logout endpoints, replacing the previous cookie-based session system. Includes rate limiting on auth routes and automatic token refresh.
${prSummaryClose}${(() => {
    // Build the context + learnings block instructions based on enable flags
    const parts: string[] = [];

    if (enableContext) {
      parts.push(`
REQUIRED: At the very end of your response, include a ${contextOpen}...${contextClose} block. Record session-scoped notes that will help you (or a future iteration) stay oriented: code locations discovered, API surfaces explored, architectural decisions made, navigation breadcrumbs, and working-state observations. These notes are ephemeral — they persist only for the current plan's run, not across plans.
If you have no context notes this iteration, use:
${contextOpen}none${contextClose}
The ${contextOpen}...${contextClose} block is mandatory in every response. Ralphai will parse it and carry forward the notes to subsequent iterations.`);
    }

    if (enableLearnings && enableContext) {
      parts.push(`
REQUIRED: Also include a ${learningsOpen}...${learningsClose} block. If you made a mistake or learned something this iteration, write a durable, generalizable lesson as freeform prose — something worth considering for AGENTS.md. Do not log one-off typos or dead ends.
IMPORTANT: Do NOT put session-specific notes (file paths, API signatures, code locations, navigation breadcrumbs) in the learnings block — those belong in the ${contextOpen}...${contextClose} block above. Learnings are for durable behavioral lessons that would still be useful if the codebase had changed since this iteration.
A learning must be durable: ask yourself "would this still be useful if the codebase had changed since this iteration?" If the answer is no, it is a session note, not a learning — put it in the context block instead.
Do NOT log: where a specific file lives, what a function signature looks like after you just read it, or a narration of your exploration steps. These are session notes that belong in context.
DO log: behavioral patterns, architectural constraints, recurring failure modes, and project conventions that would help a future agent avoid a class of mistakes.
Use:
${learningsOpen}
Your freeform prose lesson here.
${learningsClose}
If no learnings this iteration, use:
${learningsOpen}none${learningsClose}
The ${learningsOpen}...${learningsClose} block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.`);
    } else if (enableLearnings) {
      parts.push(`
REQUIRED: At the very end of your response, include a ${learningsOpen}...${learningsClose} block. If you made a mistake or learned something this iteration, write a durable, generalizable lesson as freeform prose — something worth considering for AGENTS.md. Do not log one-off typos or dead ends.
A learning must be durable: ask yourself "would this still be useful if the codebase had changed since this iteration?" If the answer is no, it is a session note, not a learning — omit it.
Do NOT log: where a specific file lives, what a function signature looks like after you just read it, or a narration of your exploration steps. These are session notes that go stale immediately.
DO log: behavioral patterns, architectural constraints, recurring failure modes, and project conventions that would help a future agent avoid a class of mistakes.
Use:
${learningsOpen}
Your freeform prose lesson here.
${learningsClose}
If no learnings this iteration, use:
${learningsOpen}none${learningsClose}
The ${learningsOpen}...${learningsClose} block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.`);
    }

    return parts.join("");
  })()}
${progressBlock}`;
}

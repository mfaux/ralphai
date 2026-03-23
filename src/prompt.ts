/**
 * Prompt assembly: formats file references and builds the full agent
 * prompt string for each turn of the runner loop.
 *
 * All file references are inlined (file content embedded in `<file>` XML
 * tags). The `at-path` and `auto` prompt modes have been removed.
 */
import { existsSync, readFileSync } from "fs";

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
  /** Runner mode: "branch", "pr", or "patch". */
  mode: "branch" | "pr" | "patch";
  /** Path to .ralphai/LEARNINGS.md (checked for existence). */
  learningsFile: string;
  /** Path to .ralphai/LEARNING_CANDIDATES.md. */
  learningCandidatesFile: string;
}

// ---------------------------------------------------------------------------
// formatFileRef
// ---------------------------------------------------------------------------

/**
 * Format a file reference for the agent prompt.
 *
 * Reads the file and wraps contents in `<file path="...">...</file>` XML
 * tags. Falls back to `@<filepath>` if the file does not exist.
 */
export function formatFileRef(filepath: string): string {
  if (existsSync(filepath)) {
    const content = readFileSync(filepath, "utf8");
    return `<file path="${filepath}">\n${content}\n</file>`;
  }
  // File doesn't exist — fall back to at-path reference
  return `@${filepath}`;
}

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

/**
 * Build the full agent prompt for a single turn.
 *
 * Mode-aware conditionals handle patch vs. branch/PR mode differences.
 */
export function assemblePrompt(options: AssemblePromptOptions): string {
  const {
    planFile,
    progressFile,
    feedbackCommands,
    scopeHint,
    mode,
    learningsFile,
    learningCandidatesFile,
  } = options;

  const planRef = formatFileRef(planFile);
  const progressRef = formatFileRef(progressFile);
  const hasLearnings = existsSync(learningsFile);

  // --- File references header ---
  let fileRefs = ` ${planRef} ${progressRef}`;
  let learningsHint = "";
  let learningsStep = "";

  if (hasLearnings) {
    const learningsRef = formatFileRef(learningsFile);
    fileRefs += ` ${learningsRef}`;
    learningsHint =
      ` Also read ${learningsFile} as a rolling anti-repeat memory.` +
      ` Apply durable lessons, but do not overfit to stale or overly specific anecdotes.`;
    learningsStep = buildLearningsStep(learningsFile, learningCandidatesFile);
  }

  // --- Feedback commands text ---
  const feedbackText = feedbackCommands
    ? feedbackCommands.split(",").join(", ")
    : "";

  // --- Step numbering (shifts when learnings steps are present) ---
  const progressStepNum = hasLearnings ? "7" : "6";
  const commitStepNum = hasLearnings ? "8" : "7";

  // --- Mode-aware instructions ---
  const feedbackStep = feedbackText
    ? `Run all feedback loops: ${feedbackText}. Fix any failures before continuing.`
    : `Run your project's build, test, and lint commands. Fix any failures before continuing.`;

  const commitInstruction =
    mode === "patch"
      ? "Leave all changes uncommitted in the working tree. Do NOT run git add or git commit."
      : "Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish a turn with uncommitted changes.";

  const completeInstruction =
    mode === "patch"
      ? "no commit is needed in patch mode."
      : "but ONLY after committing. Never output COMPLETE with uncommitted changes.";

  // --- Assemble the prompt ---
  return `${fileRefs}${scopeHint}
1. Read the referenced files and the progress file.${learningsHint}
2. Find the highest-priority incomplete task (see prioritization rules in the plan).
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
${progressStepNum}. Update ${progressFile} with what you did, decisions made, files changed, and any blockers. For each task you completed, include a heading and status marker in this exact format:
   ### Task N: <title>
   **Status:** Complete
   <summary of what was done>
   This format is required — ralphai parses it to track task completion.
${commitStepNum}. ${commitInstruction}
Work on the next incomplete task. If it is small and closely related to the following task(s), you may combine them into one turn and one commit. Do not combine tasks if you expect the total work to fill your context window. Log each completed task in progress.md with its own heading and status marker.
If all tasks are complete, output <promise>COMPLETE</promise> — ${completeInstruction}
REQUIRED: At the very end of your response, include a <learnings> block. If you made a mistake or learned something this turn, use:
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
If no learnings this turn, use:
<learnings>
<entry>
status: none
</entry>
</learnings>
The <learnings> block is mandatory in every response. Ralphai will parse it and persist logged entries automatically.
REQUIRED: Also include a <progress> block summarizing what you accomplished this turn:
<progress>
Short summary of what was done, decisions made, and current status.
</progress>
Ralphai extracts this block and appends it to the progress file automatically.`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the learnings instruction steps (steps 6-10 when learnings exist).
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

7. If you make a mistake, add or update an entry in ${learningsFile} only if it would help future runs avoid the same class of error.
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

8. If a lesson appears durable, repo-specific, or useful beyond the current task, do not edit AGENTS.md.
   Instead, append a short candidate entry to ${learningCandidatesFile} for later human review.

9. Treat ${learningCandidatesFile} as a review queue, not as active instructions.
   Candidate entries should include:
   - Date
   - Proposed rule
   - Why it matters
   - Suggested destination

10. Never edit AGENTS.md automatically based on learnings or candidates.`;
}

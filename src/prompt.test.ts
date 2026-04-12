import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  formatFileRef,
  assemblePrompt,
  extractAgentInstructions,
  DEFAULT_PREAMBLE,
} from "./prompt.ts";
import type { AssemblePromptOptions } from "./prompt.ts";

// ---------------------------------------------------------------------------
// formatFileRef (always inline)
// ---------------------------------------------------------------------------

describe("formatFileRef", () => {
  const ctx = useTempDir();

  it("returns inline placeholder XML when file does not exist", () => {
    const result = formatFileRef("/nonexistent/file.md");
    expect(result).toBe(
      `<file path="/nonexistent/file.md">\n(No content yet.)\n</file>`,
    );
  });

  it("wraps file contents in XML tags", () => {
    const filePath = join(ctx.dir, "test.md");
    writeFileSync(filePath, "# Hello\nWorld");
    const result = formatFileRef(filePath);
    expect(result).toBe(`<file path="${filePath}">\n# Hello\nWorld\n</file>`);
  });

  it("handles empty file", () => {
    const filePath = join(ctx.dir, "empty.md");
    writeFileSync(filePath, "");
    const result = formatFileRef(filePath);
    expect(result).toBe(`<file path="${filePath}">\n\n</file>`);
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

describe("assemblePrompt", () => {
  const ctx = useTempDir();

  function baseOptions(
    overrides?: Partial<AssemblePromptOptions>,
  ): AssemblePromptOptions {
    return {
      planFile: "plan.md",
      progressFile: "progress.md",
      feedbackCommands: "",
      scopeHint: "",
      learnings: [],
      ...overrides,
    };
  }

  it("includes inline plan and progress file references even when files are missing", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain(
      `<file path="plan.md">\n(No content yet.)\n</file>`,
    );
    expect(prompt).toContain(
      `<file path="progress.md">\n(No content yet.)\n</file>`,
    );
    expect(prompt).not.toContain("@progress.md");
  });

  it("includes numbered instruction steps", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain(
      "1. Review the plan and progress content provided above",
    );
    expect(prompt).toContain("2. Find the highest-priority incomplete task");
    expect(prompt).toContain("3. Implement it with small, focused changes");
  });

  it("uses generic feedback text when no commands configured", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackCommands: "" }));
    expect(prompt).toContain(
      "Run your project's build, test, and lint commands",
    );
  });

  it("includes specific feedback commands when configured", () => {
    const prompt = assemblePrompt(
      baseOptions({ feedbackCommands: "bun run build,bun test" }),
    );
    expect(prompt).toContain("Run all feedback loops: bun run build, bun test");
  });

  // --- Wrapper path ---

  it("references wrapper script in step 4 when wrapperPath is set", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackCommands: "bun run build,bun test",
        wrapperPath:
          "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh",
      }),
    );
    expect(prompt).toContain(
      "`" +
        "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh" +
        "`",
    );
    expect(prompt).toContain("Run the feedback wrapper:");
  });

  it("explains wrapper behavior (summary on pass, full output on failure) when wrapperPath is set", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackCommands: "bun run build,bun test",
        wrapperPath:
          "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh",
      }),
    );
    expect(prompt).toContain("one-line summary");
    expect(prompt).toContain("full output");
  });

  it("does not list raw commands when wrapperPath is set", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackCommands: "bun run build,bun test",
        wrapperPath:
          "/home/user/.ralphai/repos/abc/pipeline/in-progress/my-plan/_ralphai_feedback.sh",
      }),
    );
    expect(prompt).not.toContain(
      "Run all feedback loops: bun run build, bun test",
    );
  });

  it("falls back to raw commands when wrapperPath is absent", () => {
    const prompt = assemblePrompt(
      baseOptions({ feedbackCommands: "bun run build,bun test" }),
    );
    expect(prompt).toContain("Run all feedback loops: bun run build, bun test");
    expect(prompt).not.toContain("_ralphai_feedback.sh");
  });

  it("falls back to generic feedback text when wrapperPath is absent and no commands", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackCommands: "" }));
    expect(prompt).toContain(
      "Run your project's build, test, and lint commands",
    );
    expect(prompt).not.toContain("_ralphai_feedback.sh");
  });

  it("includes commit instruction", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Stage and commit ALL changes");
    expect(prompt).toContain("conventional commit message");
  });

  it("includes commit-aware COMPLETE instruction", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
  });

  it("includes learnings block template (bare tags when no nonce)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("<learnings>none</learnings>");
    expect(prompt).toContain("block is mandatory in every response");
  });

  it("includes scope hint when provided", () => {
    const hint =
      "\nThis plan is scoped to packages/core. Focus your changes on files within this directory.";
    const prompt = assemblePrompt(baseOptions({ scopeHint: hint }));
    expect(prompt).toContain("scoped to packages/core");
  });

  it("omits scope hint when empty", () => {
    const prompt = assemblePrompt(baseOptions({ scopeHint: "" }));
    // The prompt should not contain scope-related text
    expect(prompt).not.toContain("scoped to");
  });

  // --- Learnings integration (in-memory) ---

  it("omits learnings context when learnings array is empty", () => {
    const prompt = assemblePrompt(baseOptions({ learnings: [] }));
    expect(prompt).not.toContain("Learnings from previous iterations");
    expect(prompt).not.toContain("Apply any relevant learnings");
  });

  it("includes accumulated learnings with advisory framing when non-empty", () => {
    const prompt = assemblePrompt(
      baseOptions({
        learnings: [
          "Always run type-check before committing.",
          "Use path.join() for cross-platform paths.",
        ],
      }),
    );
    expect(prompt).toContain("Learnings from previous iterations");
    expect(prompt).toContain("guidance, not ground truth");
    expect(prompt).toContain("Always run type-check before committing.");
    expect(prompt).toContain("Use path.join() for cross-platform paths.");
    expect(prompt).toContain("Apply any relevant learnings");
  });

  it("does not reference LEARNINGS.md or LEARNING_CANDIDATES.md file paths", () => {
    const prompt = assemblePrompt(
      baseOptions({
        learnings: ["Some learning"],
      }),
    );
    expect(prompt).not.toContain("LEARNINGS.md");
    expect(prompt).not.toContain("LEARNING_CANDIDATES.md");
  });

  it("does not reference learnings file paths when learnings are empty", () => {
    const prompt = assemblePrompt(baseOptions({ learnings: [] }));
    expect(prompt).not.toContain("LEARNINGS.md");
    expect(prompt).not.toContain("LEARNING_CANDIDATES.md");
  });

  it("instructs freeform prose in learnings block, not structured fields", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("freeform prose");
    expect(prompt).toContain("durable, generalizable lesson");
    // Should NOT contain the old structured field template
    expect(prompt).not.toContain("status: logged");
    expect(prompt).not.toContain("date: YYYY-MM-DD");
    expect(prompt).not.toContain("title: Short description");
    expect(prompt).not.toContain("root_cause:");
    expect(prompt).not.toContain("prevention:");
  });

  it("instructs agent to write <learnings>none</learnings> when nothing to report", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<learnings>none</learnings>");
  });

  it("instructs agent to only report durable generalizable lessons", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("durable, generalizable lesson");
    expect(prompt).toContain("Do not log one-off typos or dead ends");
  });

  // --- Richer learnings guidance ---

  it("learnings prompt does not contain removed file-path or API example bullets", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).not.toContain("File paths modified or discovered");
    expect(prompt).not.toContain("Exported APIs and their signatures");
  });

  it("learnings prompt includes negative guidance about what not to log", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Do NOT log:");
    // With context enabled (default), session notes go to context block
    expect(prompt).toContain("session notes that belong in context");
  });

  it("learnings prompt includes durability quality-gate heuristic", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain(
      "would this still be useful if the codebase had changed since this iteration?",
    );
    expect(prompt).toContain("session note, not a learning");
  });

  it("learnings prompt retains guidance about behavioral patterns and architecture constraints", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("behavioral patterns");
    expect(prompt).toContain("architectural constraints");
    expect(prompt).toContain("recurring failure modes");
    expect(prompt).toContain("project conventions");
  });

  it("learnings guidance remains freeform prose (no structured schema)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("freeform prose");
    // Should not introduce structured YAML/JSON fields
    expect(prompt).not.toContain("file_paths:");
    expect(prompt).not.toContain("apis:");
    expect(prompt).not.toContain('"file_paths"');
  });

  it("commit step is always step 5 regardless of learnings", () => {
    const withoutLearnings = assemblePrompt(baseOptions({ learnings: [] }));
    expect(withoutLearnings).toContain("5. Stage and commit ALL changes");

    const withLearnings = assemblePrompt(
      baseOptions({ learnings: ["some lesson"] }),
    );
    expect(withLearnings).toContain("5. Stage and commit ALL changes");
  });

  // --- Inline file references ---

  it("inlines file content with labels instead of absolute paths", () => {
    const planPath = join(ctx.dir, "plan.md");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(planPath, "# My Plan\nTask 1: do stuff");
    writeFileSync(progressPath, "## Progress\nNothing yet.");

    const prompt = assemblePrompt(
      baseOptions({
        planFile: planPath,
        progressFile: progressPath,
      }),
    );
    // Labels are used in file tags, not absolute paths
    expect(prompt).toContain(`<file path="plan.md">`);
    expect(prompt).toContain("# My Plan");
    expect(prompt).toContain(`<file path="progress.md">`);
    expect(prompt).toContain("Nothing yet.");
    // Absolute paths must NOT appear
    expect(prompt).not.toContain(`<file path="${planPath}">`);
    expect(prompt).not.toContain(`<file path="${progressPath}">`);
  });

  // --- Documentation mandate (now part of default preamble) ---

  it("includes documentation mandate in default preamble", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Documentation mandate");
    expect(prompt).toContain("AGENTS.md");
  });

  // --- Testing strategy (now part of default preamble) ---

  it("includes testing strategy in default preamble", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Bug fix: Write a failing test FIRST");
    expect(prompt).toContain("New feature: Implement the feature");
    expect(prompt).toContain("Refactor: Verify existing tests pass");
  });

  // --- Progress via structured output ---

  it("requires structured task markers inside <progress> block", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<progress>");
    expect(prompt).toContain("### Task N: <title>");
    expect(prompt).toContain("**Status:** Complete");
    expect(prompt).toContain("ralphai parses it to track task completion");
    expect(prompt).toContain("Do NOT write progress.md directly");
  });

  it("does not instruct agents to update progress.md directly", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).not.toContain("Update progress.md");
  });

  // --- Format-aware prompt (tasks / default) ---

  it("uses tasks-format step 2 by default", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("2. Find the highest-priority incomplete task");
    expect(prompt).not.toContain("unchecked items");
  });

  it("uses tasks-format step 2 when planFormat is 'tasks'", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "tasks" }));
    expect(prompt).toContain("2. Find the highest-priority incomplete task");
  });

  it("uses tasks-format step 2 when planFormat is 'none'", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "none" }));
    expect(prompt).toContain("2. Find the highest-priority incomplete task");
  });

  // --- Continue-if-small wording ---

  it("includes continue-if-small guidance in tasks format step 2", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "tasks" }));
    expect(prompt).toContain(
      "If the following task is trivially small, continue to it",
    );
  });

  it("includes continue-if-small guidance in default format step 2", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain(
      "If the following task is trivially small, continue to it",
    );
  });

  it("does not include continue-if-small in checkboxes format step 2", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).not.toContain(
      "If the following task is trivially small, continue to it",
    );
  });

  it("continue-if-small wording does not change COMPLETE signal behavior", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "tasks" }));
    expect(prompt).toContain("<promise>COMPLETE</promise>");
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
    // The unless-trivially-small caveat is in the one-task-per-iteration paragraph
    expect(prompt).toContain(
      "Do not continue to the next task unless it is trivially small",
    );
  });

  it("instructs agent to complete only one task per iteration (with trivially-small exception)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Complete ONLY the task identified in step 2");
    expect(prompt).toContain("you will be re-invoked with updated progress");
    expect(prompt).toContain(
      "do not attempt to complete the entire plan in one pass",
    );
    expect(prompt).toContain(
      "Do not continue to the next task unless it is trivially small",
    );
  });

  it("references 'all tasks complete' for tasks format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "tasks" }));
    expect(prompt).toContain("all tasks complete");
    expect(prompt).not.toContain("all items checked");
  });

  // --- Format-aware prompt (checkboxes) ---

  it("uses checkbox-format step 2 when planFormat is 'checkboxes'", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain(
      "2. Pick the next group of unchecked items from the plan",
    );
    expect(prompt).not.toContain("Find the highest-priority incomplete task");
  });

  it("allows multiple items per iteration for checkboxes format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain(
      "You may satisfy multiple related items in one iteration",
    );
  });

  it("instructs checkbox progress blocks for checkboxes format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain("- [x] <item description>");
    expect(prompt).not.toContain("### Task N: <title>");
    expect(prompt).not.toContain("**Status:** Complete");
  });

  it("references 'all items checked' for checkboxes format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain("all items checked");
    expect(prompt).not.toContain("all tasks complete");
  });

  it("preserves COMPLETE signal for checkboxes format (bare when no nonce)", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain("<promise>COMPLETE</promise>");
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
  });

  it("preserves COMPLETE signal for tasks format (bare when no nonce)", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "tasks" }));
    expect(prompt).toContain("<promise>COMPLETE</promise>");
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
  });

  it("includes checkbox progress example in checkboxes format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain("- [x] Validate input length is within bounds");
    expect(prompt).toContain("Do NOT write progress.md directly");
  });

  // --- Nonce-stamped sentinel tags ---

  it("includes nonce-stamped COMPLETE sentinel when nonce is provided", () => {
    const nonce = "test-nonce-xyz";
    const prompt = assemblePrompt(baseOptions({ nonce }));
    expect(prompt).toContain(`<promise nonce="${nonce}">COMPLETE</promise>`);
    // Must NOT contain bare <promise>COMPLETE</promise>
    expect(prompt).not.toContain("<promise>COMPLETE</promise>");
  });

  it("includes nonce-stamped learnings tags when nonce is provided", () => {
    const nonce = "learn-nonce-42";
    const prompt = assemblePrompt(baseOptions({ nonce }));
    expect(prompt).toContain(`<learnings nonce="${nonce}">`);
    expect(prompt).toContain(`<learnings nonce="${nonce}">none</learnings>`);
    // Must NOT contain bare <learnings> as a functional tag (the terse
    // instruction mentions it in prose as "<learnings>," which is exempt)
    expect(prompt).not.toMatch(/<learnings>(?![,.])/);
  });

  it("includes nonce-stamped progress tags when nonce is provided", () => {
    const nonce = "prog-nonce-99";
    const prompt = assemblePrompt(baseOptions({ nonce }));
    expect(prompt).toContain(`<progress nonce="${nonce}">`);
    expect(prompt).toContain("</progress>");
  });

  it("includes nonce-stamped pr-summary tags when nonce is provided", () => {
    const nonce = "pr-nonce-77";
    const prompt = assemblePrompt(baseOptions({ nonce }));
    expect(prompt).toContain(`<pr-summary nonce="${nonce}">`);
    expect(prompt).toContain("</pr-summary>");
  });

  it("includes nonce-stamped tags for all sentinel types in checkboxes format", () => {
    const nonce = "checkbox-nonce";
    const prompt = assemblePrompt(
      baseOptions({ nonce, planFormat: "checkboxes" }),
    );
    expect(prompt).toContain(`<promise nonce="${nonce}">COMPLETE</promise>`);
    expect(prompt).toContain(`<learnings nonce="${nonce}">`);
    expect(prompt).toContain(`<progress nonce="${nonce}">`);
    expect(prompt).toContain(`<pr-summary nonce="${nonce}">`);
  });

  // --- Feedback scope hints ---

  it("includes scope-aware guidance when feedbackScope is set", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackScope: "src/foo" }));
    expect(prompt).toContain("Scope hint:");
    expect(prompt).toContain("focused in `src/foo/`");
  });

  it("suggests a scoped test command pattern when feedbackScope is set", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackScope: "src/foo" }));
    expect(prompt).toContain("`bun test src/foo/`");
  });

  it("advises running full suite before COMPLETE when feedbackScope is set", () => {
    const prompt = assemblePrompt(
      baseOptions({ feedbackScope: "src/components" }),
    );
    expect(prompt).toContain("full feedback suite before signaling COMPLETE");
  });

  it("omits scope guidance when feedbackScope is empty", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackScope: "" }));
    expect(prompt).not.toContain("Scope hint:");
    expect(prompt).not.toContain("focused in");
  });

  it("omits scope guidance when feedbackScope is undefined", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).not.toContain("Scope hint:");
    expect(prompt).not.toContain("focused in");
  });

  it("places scope hint adjacent to feedback step (step 4)", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackScope: "src/foo" }));
    // The scope hint should appear between step 4 and step 5
    const step4Idx = prompt.indexOf("4. ");
    const scopeIdx = prompt.indexOf("Scope hint:");
    const step5Idx = prompt.indexOf("5. Stage and commit");
    expect(step4Idx).toBeLessThan(scopeIdx);
    expect(scopeIdx).toBeLessThan(step5Idx);
  });

  // --- Terse mode (on by default, i.e. verbose=false) ---

  it("includes terse instruction by default (verbose omitted)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("TERSE MODE:");
  });

  it("includes terse instruction when verbose is false", () => {
    const prompt = assemblePrompt(baseOptions({ verbose: false }));
    expect(prompt).toContain("TERSE MODE:");
  });

  it("omits terse instruction when verbose is true", () => {
    const prompt = assemblePrompt(baseOptions({ verbose: true }));
    expect(prompt).not.toContain("TERSE MODE:");
  });

  it("terse instruction scopes abbreviated style to working commentary only", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("working commentary");
    expect(prompt).toContain("articles");
    expect(prompt).toContain("filler");
    expect(prompt).toContain("pleasantries");
    expect(prompt).toContain("hedging");
  });

  it("terse instruction specifies that technical terms must remain exact", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("technical terms");
    expect(prompt).toContain("exactly as-is");
  });

  it("terse instruction requires normal prose for persisted content", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("documentation files");
    expect(prompt).toContain("code comments");
    expect(prompt).toContain("commit messages");
    expect(prompt).toContain("PR descriptions");
    expect(prompt).toContain("normal, grammatical prose");
    expect(prompt).toContain("must not use terse style");
  });

  it("terse instruction exempts structured XML blocks", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("<progress>");
    expect(prompt).toContain("<pr-summary>");
  });

  it("terse instruction appears before the file references", () => {
    const prompt = assemblePrompt(baseOptions());
    const terseIdx = prompt.indexOf("TERSE MODE:");
    const fileRefIdx = prompt.indexOf('<file path="plan.md">');
    expect(terseIdx).toBeGreaterThanOrEqual(0);
    expect(fileRefIdx).toBeGreaterThan(terseIdx);
  });

  it("terse instruction does not affect review pass or HITL prompts (assemblePrompt only)", () => {
    // This test confirms verbose is a property of assemblePrompt only.
    // Review and HITL have separate prompt assembly functions that
    // do not accept a verbose option — verified by type system.
    const promptDefault = assemblePrompt(baseOptions());
    const promptVerbose = assemblePrompt(baseOptions({ verbose: true }));
    // Default (concise) should have terse preamble; verbose=true should not
    expect(promptDefault).toContain("TERSE MODE:");
    expect(promptVerbose).not.toContain("TERSE MODE:");
    // Both should still contain the core instruction steps
    expect(promptDefault).toContain("1. Review the plan");
    expect(promptVerbose).toContain("1. Review the plan");
  });

  // --- Preamble ---

  it("uses DEFAULT_PREAMBLE when preamble option is empty (default)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Testing strategy");
    expect(prompt).toContain("Documentation mandate");
  });

  it("uses DEFAULT_PREAMBLE when preamble option is explicitly empty string", () => {
    const prompt = assemblePrompt(baseOptions({ preamble: "" }));
    expect(prompt).toContain("Testing strategy");
    expect(prompt).toContain("Documentation mandate");
  });

  it("replaces default preamble entirely when non-empty preamble is set", () => {
    const customPreamble =
      "Always write comprehensive integration tests before any code changes.";
    const prompt = assemblePrompt(baseOptions({ preamble: customPreamble }));
    expect(prompt).toContain(customPreamble);
    // Default preamble content should NOT be present
    expect(prompt).not.toContain("Testing strategy");
    expect(prompt).not.toContain("Documentation mandate");
  });

  it("places preamble before file references", () => {
    const customPreamble = "CUSTOM_PREAMBLE_MARKER";
    const prompt = assemblePrompt(baseOptions({ preamble: customPreamble }));
    const preambleIdx = prompt.indexOf("CUSTOM_PREAMBLE_MARKER");
    const fileRefIdx = prompt.indexOf('<file path="plan.md">');
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(fileRefIdx).toBeGreaterThan(preambleIdx);
  });

  it("DEFAULT_PREAMBLE constant contains both testing strategy and docs mandate", () => {
    expect(DEFAULT_PREAMBLE).toContain("Testing strategy");
    expect(DEFAULT_PREAMBLE).toContain("Bug fix:");
    expect(DEFAULT_PREAMBLE).toContain("Documentation mandate");
  });

  // --- Agent Instructions ---

  it("includes agent instructions between preamble and file references when provided", () => {
    const instructions =
      "Focus on performance. Avoid allocations in hot paths.";
    const prompt = assemblePrompt(
      baseOptions({ agentInstructions: instructions }),
    );
    expect(prompt).toContain(instructions);
    const instrIdx = prompt.indexOf(instructions);
    const fileRefIdx = prompt.indexOf('<file path="plan.md">');
    expect(instrIdx).toBeGreaterThanOrEqual(0);
    expect(fileRefIdx).toBeGreaterThan(instrIdx);
  });

  it("omits agent instructions section when empty", () => {
    const prompt = assemblePrompt(baseOptions({ agentInstructions: "" }));
    // Should not have a dangling empty section between preamble and file refs
    expect(prompt).not.toMatch(/\n\n\n\n/);
  });

  // --- enableLearnings ---

  it("includes learnings mandate when enableLearnings is true (default)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("block is mandatory in every response");
  });

  it("includes learnings mandate when enableLearnings is explicitly true", () => {
    const prompt = assemblePrompt(baseOptions({ enableLearnings: true }));
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("block is mandatory in every response");
  });

  it("omits learnings mandate when enableLearnings is false", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableLearnings: false, enableContext: false }),
    );
    expect(prompt).not.toContain("block is mandatory in every response");
    expect(prompt).not.toContain("freeform prose lesson");
    // Should still have progress block
    expect(prompt).toContain("<progress>");
  });

  it("omits learnings template blocks when enableLearnings is false", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableLearnings: false, enableContext: false }),
    );
    expect(prompt).not.toContain("<learnings>none</learnings>");
    expect(prompt).not.toContain("Your freeform prose lesson here.");
  });

  // --- Context integration ---

  it("includes context section when context array is non-empty", () => {
    const prompt = assemblePrompt(
      baseOptions({
        context: [
          "src/prompt.ts contains assemblePrompt()",
          "Config uses Zod schema in src/config.ts",
        ],
      }),
    );
    expect(prompt).toContain("Context from previous iterations");
    expect(prompt).toContain("src/prompt.ts contains assemblePrompt()");
    expect(prompt).toContain("Config uses Zod schema in src/config.ts");
  });

  it("omits context section when context array is empty", () => {
    const prompt = assemblePrompt(baseOptions({ context: [] }));
    expect(prompt).not.toContain("Context from previous iterations");
  });

  it("omits context section when context is not provided (defaults to empty)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).not.toContain("Context from previous iterations");
  });

  it("omits context section when enableContext is false regardless of array content", () => {
    const prompt = assemblePrompt(
      baseOptions({
        context: ["Some important context note"],
        enableContext: false,
      }),
    );
    expect(prompt).not.toContain("Context from previous iterations");
    expect(prompt).not.toContain("Some important context note");
  });

  it("includes <context> block template when enableContext is true (default)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("<context>none</context>");
    expect(prompt).toContain("session-scoped notes");
  });

  it("includes <context> block template when enableContext is explicitly true", () => {
    const prompt = assemblePrompt(baseOptions({ enableContext: true }));
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("<context>none</context>");
  });

  it("omits <context> block template when enableContext is false", () => {
    const prompt = assemblePrompt(baseOptions({ enableContext: false }));
    expect(prompt).not.toContain("<context>none</context>");
    expect(prompt).not.toContain("session-scoped notes");
  });

  it("places context section before learnings section in the prompt", () => {
    const prompt = assemblePrompt(
      baseOptions({
        context: ["A context note"],
        learnings: ["A learning"],
      }),
    );
    const contextIdx = prompt.indexOf("Context from previous iterations");
    const learningsIdx = prompt.indexOf("Learnings from previous iterations");
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(learningsIdx).toBeGreaterThan(contextIdx);
  });

  it("when both tiers enabled, learnings instruction says NOT to put session notes in learnings", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableContext: true, enableLearnings: true }),
    );
    expect(prompt).toContain("Do NOT put session-specific notes");
    expect(prompt).toContain("belong in the <context");
  });

  it("when only context enabled, only <context> block instruction appears", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableContext: true, enableLearnings: false }),
    );
    expect(prompt).toContain("<context>none</context>");
    expect(prompt).not.toContain("<learnings>none</learnings>");
    expect(prompt).not.toContain("freeform prose lesson");
  });

  it("when only learnings enabled, only <learnings> block instruction appears (no mention of context)", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableContext: false, enableLearnings: true }),
    );
    expect(prompt).toContain("<learnings>none</learnings>");
    expect(prompt).not.toContain("<context>none</context>");
    expect(prompt).not.toContain("session-scoped notes");
  });

  it("when both disabled, neither block instruction appears", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableContext: false, enableLearnings: false }),
    );
    expect(prompt).not.toContain("<learnings>none</learnings>");
    expect(prompt).not.toContain("<context>none</context>");
    expect(prompt).not.toContain("session-scoped notes");
    expect(prompt).not.toContain("freeform prose lesson");
    // Progress should still be present
    expect(prompt).toContain("<progress>");
  });

  it("includes nonce-stamped <context> tags when nonce is provided", () => {
    const nonce = "ctx-nonce-55";
    const prompt = assemblePrompt(baseOptions({ nonce }));
    expect(prompt).toContain(`<context nonce="${nonce}">`);
    expect(prompt).toContain(`<context nonce="${nonce}">none</context>`);
    // Must NOT contain bare <context>none</context>
    expect(prompt).not.toContain("<context>none</context>");
  });

  it("includes context hint in step 1 when context array is non-empty", () => {
    const prompt = assemblePrompt(
      baseOptions({ context: ["Some context note"] }),
    );
    expect(prompt).toContain(
      "Review any context notes from previous iterations",
    );
  });

  it("omits context hint in step 1 when context array is empty", () => {
    const prompt = assemblePrompt(baseOptions({ context: [] }));
    expect(prompt).not.toContain(
      "Review any context notes from previous iterations",
    );
  });

  it("when only learnings enabled, learnings instruction uses 'omit' not 'put in context'", () => {
    const prompt = assemblePrompt(
      baseOptions({ enableContext: false, enableLearnings: true }),
    );
    // Should use the standalone learnings wording ("omit it") not the
    // two-tier wording ("put it in the context block")
    expect(prompt).toContain("session note, not a learning — omit it");
    expect(prompt).not.toContain("put it in the context block");
  });

  // --- commitStyle ---

  it("uses conventional commit instruction when commitStyle is 'conventional' (default)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("conventional commit message");
    expect(prompt).toContain("feat: ..., fix: ..., refactor: ...");
  });

  it("uses conventional commit instruction when commitStyle is explicitly 'conventional'", () => {
    const prompt = assemblePrompt(baseOptions({ commitStyle: "conventional" }));
    expect(prompt).toContain("conventional commit message");
  });

  it("uses generic commit instruction when commitStyle is 'none'", () => {
    const prompt = assemblePrompt(baseOptions({ commitStyle: "none" }));
    expect(prompt).toContain("clear, descriptive commit message");
    expect(prompt).not.toContain("conventional commit message");
    expect(prompt).not.toContain("feat: ..., fix: ...");
  });

  // --- feedbackHint (scope hint test command) ---

  it("uses feedbackHint for scope hint test command when provided", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackScope: "src/foo",
        feedbackHint: "npm test",
      }),
    );
    expect(prompt).toContain("`npm test src/foo/`");
    expect(prompt).not.toContain("`bun test src/foo/`");
  });

  it("falls back to 'bun test' in scope hint when feedbackHint is empty", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackScope: "src/foo",
        feedbackHint: "",
      }),
    );
    expect(prompt).toContain("`bun test src/foo/`");
  });

  it("falls back to 'bun test' in scope hint when feedbackHint is omitted", () => {
    const prompt = assemblePrompt(baseOptions({ feedbackScope: "src/bar" }));
    expect(prompt).toContain("`bun test src/bar/`");
  });
});

// ---------------------------------------------------------------------------
// extractAgentInstructions
// ---------------------------------------------------------------------------

describe("extractAgentInstructions", () => {
  it("returns empty instructions and unchanged content when no section exists", () => {
    const content = "# Plan\n\n## Tasks\n\n- [ ] Do stuff\n";
    const result = extractAgentInstructions(content);
    expect(result.instructions).toBe("");
    expect(result.strippedContent).toBe(content);
  });

  it("extracts text under ## Agent Instructions heading", () => {
    const content = [
      "# Plan",
      "",
      "## Agent Instructions",
      "",
      "Always use TypeScript strict mode.",
      "Prefer const over let.",
      "",
      "## Tasks",
      "",
      "- [ ] Implement feature",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.instructions).toContain("Always use TypeScript strict mode.");
    expect(result.instructions).toContain("Prefer const over let.");
  });

  it("strips the Agent Instructions section from content", () => {
    const content = [
      "# Plan",
      "",
      "## Agent Instructions",
      "",
      "Focus on performance.",
      "",
      "## Tasks",
      "",
      "- [ ] Optimize queries",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.strippedContent).not.toContain("## Agent Instructions");
    expect(result.strippedContent).not.toContain("Focus on performance.");
    expect(result.strippedContent).toContain("## Tasks");
    expect(result.strippedContent).toContain("Optimize queries");
  });

  it("handles Agent Instructions at end of file", () => {
    const content = [
      "# Plan",
      "",
      "## Tasks",
      "",
      "- [ ] Do stuff",
      "",
      "## Agent Instructions",
      "",
      "Use TDD approach.",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.instructions).toBe("Use TDD approach.");
    expect(result.strippedContent).not.toContain("Agent Instructions");
    expect(result.strippedContent).toContain("## Tasks");
  });

  it("does not match ### Agent Instructions (level-3 heading)", () => {
    const content = [
      "# Plan",
      "",
      "### Agent Instructions",
      "",
      "Not extracted.",
      "",
      "## Tasks",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.instructions).toBe("");
    expect(result.strippedContent).toBe(content);
  });

  it("stops at next level-2 heading", () => {
    const content = [
      "## Agent Instructions",
      "",
      "Line 1.",
      "Line 2.",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] Pass tests",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.instructions).toBe("Line 1.\nLine 2.");
    expect(result.strippedContent).toContain("## Acceptance Criteria");
    expect(result.strippedContent).toContain("Pass tests");
  });

  it("stops at level-1 heading", () => {
    const content = [
      "## Agent Instructions",
      "",
      "Be careful.",
      "",
      "# New Section",
      "",
      "Content here.",
    ].join("\n");
    const result = extractAgentInstructions(content);
    expect(result.instructions).toBe("Be careful.");
    expect(result.strippedContent).toContain("# New Section");
  });
});

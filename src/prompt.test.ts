import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { formatFileRef, assemblePrompt } from "./prompt.ts";
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
        wrapperPath: "./_ralphai_feedback.sh",
      }),
    );
    expect(prompt).toContain("`" + "./_ralphai_feedback.sh" + "`");
    expect(prompt).toContain("Run the feedback wrapper:");
  });

  it("explains wrapper behavior (summary on pass, full output on failure) when wrapperPath is set", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackCommands: "bun run build,bun test",
        wrapperPath: "./_ralphai_feedback.sh",
      }),
    );
    expect(prompt).toContain("one-line summary");
    expect(prompt).toContain("full output");
  });

  it("does not list raw commands when wrapperPath is set", () => {
    const prompt = assemblePrompt(
      baseOptions({
        feedbackCommands: "bun run build,bun test",
        wrapperPath: "./_ralphai_feedback.sh",
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

  it("learnings prompt asks for file paths, APIs/signatures, architecture constraints, and error resolutions", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("File paths modified or discovered");
    expect(prompt).toContain("Exported APIs and their signatures");
    expect(prompt).toContain("Architecture constraints or patterns observed");
    expect(prompt).toContain(
      "Error messages encountered and how they were resolved",
    );
  });

  it("learnings guidance remains freeform prose (no structured schema)", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("freeform prose");
    // Should not introduce structured YAML/JSON fields
    expect(prompt).not.toContain("file_paths:");
    expect(prompt).not.toContain("apis:");
    expect(prompt).not.toContain('"file_paths"');
  });

  it("commit step is always step 6 regardless of learnings", () => {
    const withoutLearnings = assemblePrompt(baseOptions({ learnings: [] }));
    expect(withoutLearnings).toContain("6. Stage and commit ALL changes");
    expect(withoutLearnings).not.toContain("10. Stage and commit ALL changes");

    const withLearnings = assemblePrompt(
      baseOptions({ learnings: ["some lesson"] }),
    );
    expect(withLearnings).toContain("6. Stage and commit ALL changes");
    expect(withLearnings).not.toContain("10. Stage and commit ALL changes");
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

  // --- Documentation step ---

  it("includes documentation review instructions", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("5. Documentation:");
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("AGENTS.md");
  });

  // --- Testing strategy ---

  it("includes testing strategy for different task types", () => {
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
    // Must NOT contain bare <learnings>
    expect(prompt).not.toMatch(/<learnings>(?!\.)/);
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
    const step5Idx = prompt.indexOf("5. Documentation:");
    expect(step4Idx).toBeLessThan(scopeIdx);
    expect(scopeIdx).toBeLessThan(step5Idx);
  });
});

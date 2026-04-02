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
    expect(prompt).toContain("1. Read the referenced files");
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

  it("includes learnings block template", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("<learnings>none</learnings>");
    expect(prompt).toContain(
      "The <learnings> block is mandatory in every response",
    );
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

  it("instructs agent to complete only one task per iteration", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("Complete ONLY the task identified in step 2");
    expect(prompt).toContain("you will be re-invoked with updated progress");
    expect(prompt).toContain(
      "do not attempt to complete the entire plan in one pass",
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

  it("preserves COMPLETE signal for checkboxes format", () => {
    const prompt = assemblePrompt(baseOptions({ planFormat: "checkboxes" }));
    expect(prompt).toContain("<promise>COMPLETE</promise>");
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
  });

  it("preserves COMPLETE signal for tasks format", () => {
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
});

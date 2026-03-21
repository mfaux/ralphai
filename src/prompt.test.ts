import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { resolvePromptMode, formatFileRef, assemblePrompt } from "./prompt.ts";
import type { AssemblePromptOptions } from "./prompt.ts";

// ---------------------------------------------------------------------------
// resolvePromptMode
// ---------------------------------------------------------------------------

describe("resolvePromptMode", () => {
  it('passes through "at-path" unchanged', () => {
    expect(resolvePromptMode("at-path", "claude")).toBe("at-path");
  });

  it('passes through "inline" unchanged', () => {
    expect(resolvePromptMode("inline", "opencode")).toBe("inline");
  });

  it('resolves "auto" to "at-path" for claude', () => {
    expect(resolvePromptMode("auto", "claude")).toBe("at-path");
  });

  it('resolves "auto" to "at-path" for opencode', () => {
    expect(resolvePromptMode("auto", "opencode")).toBe("at-path");
  });

  it('resolves "auto" to "at-path" for unknown agents', () => {
    expect(resolvePromptMode("auto", "unknown")).toBe("at-path");
  });

  it('resolves "auto" to "at-path" for codex', () => {
    expect(resolvePromptMode("auto", "codex")).toBe("at-path");
  });
});

// ---------------------------------------------------------------------------
// formatFileRef
// ---------------------------------------------------------------------------

describe("formatFileRef", () => {
  const ctx = useTempDir();

  it("returns @path in at-path mode", () => {
    const result = formatFileRef("plan.md", "at-path");
    expect(result).toBe("@plan.md");
  });

  it("returns @path in inline mode when file does not exist", () => {
    const result = formatFileRef("/nonexistent/file.md", "inline");
    expect(result).toBe("@/nonexistent/file.md");
  });

  it("wraps file contents in XML tags in inline mode", () => {
    const filePath = join(ctx.dir, "test.md");
    writeFileSync(filePath, "# Hello\nWorld");
    const result = formatFileRef(filePath, "inline");
    expect(result).toBe(`<file path="${filePath}">\n# Hello\nWorld\n</file>`);
  });

  it("handles empty file in inline mode", () => {
    const filePath = join(ctx.dir, "empty.md");
    writeFileSync(filePath, "");
    const result = formatFileRef(filePath, "inline");
    expect(result).toBe(`<file path="${filePath}">\n\n</file>`);
  });
});

// ---------------------------------------------------------------------------
// assemblePrompt — branch mode
// ---------------------------------------------------------------------------

describe("assemblePrompt", () => {
  const ctx = useTempDir();

  function baseOptions(
    overrides?: Partial<AssemblePromptOptions>,
  ): AssemblePromptOptions {
    return {
      planFile: "plan.md",
      progressFile: "progress.md",
      promptMode: "at-path",
      feedbackCommands: "",
      scopeHint: "",
      mode: "branch",
      learningsFile: join(ctx.dir, "LEARNINGS.md"),
      learningCandidatesFile: join(ctx.dir, "LEARNING_CANDIDATES.md"),
      ...overrides,
    };
  }

  it("includes plan and progress file references", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("@plan.md");
    expect(prompt).toContain("@progress.md");
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

  it("includes commit instruction in branch mode", () => {
    const prompt = assemblePrompt(baseOptions({ mode: "branch" }));
    expect(prompt).toContain("Stage and commit ALL changes");
    expect(prompt).toContain("conventional commit message");
  });

  it("includes no-commit instruction in patch mode", () => {
    const prompt = assemblePrompt(baseOptions({ mode: "patch" }));
    expect(prompt).toContain(
      "Leave all changes uncommitted in the working tree",
    );
    expect(prompt).toContain("Do NOT run git add or git commit");
  });

  it("includes commit-aware COMPLETE instruction in branch mode", () => {
    const prompt = assemblePrompt(baseOptions({ mode: "branch" }));
    expect(prompt).toContain(
      "but ONLY after committing. Never output COMPLETE with uncommitted changes",
    );
  });

  it("includes patch-mode COMPLETE instruction in patch mode", () => {
    const prompt = assemblePrompt(baseOptions({ mode: "patch" }));
    expect(prompt).toContain("no commit is needed in patch mode");
  });

  it("includes learnings block template", () => {
    const prompt = assemblePrompt(baseOptions());
    expect(prompt).toContain("<learnings>");
    expect(prompt).toContain("status: logged");
    expect(prompt).toContain("status: none");
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

  // --- Learnings integration ---

  it("omits learnings steps when LEARNINGS.md does not exist", () => {
    const prompt = assemblePrompt(baseOptions());
    // Step 6 should be progress update, not learnings
    expect(prompt).toContain("6. Update progress.md");
    expect(prompt).not.toContain("advisory memory");
    expect(prompt).not.toContain("LEARNING_CANDIDATES");
  });

  it("includes learnings steps when LEARNINGS.md exists", () => {
    const learningsPath = join(ctx.dir, "LEARNINGS.md");
    writeFileSync(learningsPath, "# Learnings\n");

    const prompt = assemblePrompt(baseOptions());
    // Learnings hint in step 1
    expect(prompt).toContain("rolling anti-repeat memory");
    // Learnings reference in file refs
    expect(prompt).toContain(`@${learningsPath}`);
    // Learnings steps 6-10
    expect(prompt).toContain("6. Read");
    expect(prompt).toContain("advisory memory");
    expect(prompt).toContain("7. If you make a mistake");
    expect(prompt).toContain("8. If a lesson appears durable");
    expect(prompt).toContain("9. Treat");
    expect(prompt).toContain("10. Never edit AGENTS.md");
    // Progress update step shifts to 7
    expect(prompt).toContain("7. Update progress.md");
    // Commit step shifts to 8
    expect(prompt).toContain("8. Stage and commit ALL changes");
  });

  it("includes LEARNING_CANDIDATES path in learnings steps", () => {
    const learningsPath = join(ctx.dir, "LEARNINGS.md");
    writeFileSync(learningsPath, "# Learnings\n");
    const candidatesPath = join(ctx.dir, "LEARNING_CANDIDATES.md");

    const prompt = assemblePrompt(
      baseOptions({ learningCandidatesFile: candidatesPath }),
    );
    expect(prompt).toContain(candidatesPath);
  });

  // --- PR mode ---

  it("uses commit instruction in PR mode (same as branch)", () => {
    const prompt = assemblePrompt(baseOptions({ mode: "pr" }));
    expect(prompt).toContain("Stage and commit ALL changes");
  });

  // --- Inline mode ---

  it("inlines file content in inline prompt mode", () => {
    const planPath = join(ctx.dir, "plan.md");
    const progressPath = join(ctx.dir, "progress.md");
    writeFileSync(planPath, "# My Plan\nTask 1: do stuff");
    writeFileSync(progressPath, "## Progress\nNothing yet.");

    const prompt = assemblePrompt(
      baseOptions({
        planFile: planPath,
        progressFile: progressPath,
        promptMode: "inline",
      }),
    );
    expect(prompt).toContain(`<file path="${planPath}">`);
    expect(prompt).toContain("# My Plan");
    expect(prompt).toContain(`<file path="${progressPath}">`);
    expect(prompt).toContain("Nothing yet.");
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
});

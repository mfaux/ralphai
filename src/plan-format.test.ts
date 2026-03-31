import { describe, it, expect } from "bun:test";
import {
  detectPlanFormat,
  countPlanTasksFromContent,
  countCompletedFromProgress,
} from "./plan-detection.ts";

// ---------------------------------------------------------------------------
// detectPlanFormat
// ---------------------------------------------------------------------------

describe("detectPlanFormat", () => {
  // --- Format: tasks (### Task N: headings) ---

  it("returns format 'tasks' with correct count for task headings", () => {
    const content = [
      "# Plan",
      "",
      "### Task 1: First",
      "Details...",
      "",
      "### Task 2: Second",
      "Details...",
      "",
      "### Task 3: Third",
      "Details...",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("tasks");
    expect(result.totalTasks).toBe(3);
  });

  it("returns format 'tasks' for a single task heading", () => {
    const result = detectPlanFormat("# Plan\n\n### Task 1: Only task\n");
    expect(result.format).toBe("tasks");
    expect(result.totalTasks).toBe(1);
  });

  // --- Format: checkboxes (- [ ] / - [x]) ---

  it("returns format 'checkboxes' with correct count for unchecked checkboxes", () => {
    const content = [
      "# Plan",
      "",
      "- [ ] First task",
      "- [ ] Second task",
      "- [ ] Third task",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("checkboxes");
    expect(result.totalTasks).toBe(3);
  });

  it("includes pre-checked [x] items in the total count", () => {
    const content = [
      "# Plan",
      "",
      "- [x] Already done",
      "- [ ] Still pending",
      "- [x] Also done",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("checkboxes");
    expect(result.totalTasks).toBe(3);
  });

  it("counts checkboxes in multiple sections", () => {
    const content = [
      "# Plan",
      "",
      "## Section A",
      "- [ ] Task A1",
      "- [x] Task A2",
      "",
      "## Section B",
      "- [ ] Task B1",
      "- [ ] Task B2",
      "- [x] Task B3",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("checkboxes");
    expect(result.totalTasks).toBe(5);
  });

  // --- Format: tasks wins over checkboxes ---

  it("returns format 'tasks' when both headings and checkboxes are present", () => {
    const content = [
      "# Plan",
      "",
      "### Task 1: Feature A",
      "- [ ] subtask",
      "- [ ] subtask",
      "",
      "### Task 2: Feature B",
      "- [x] subtask",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("tasks");
    expect(result.totalTasks).toBe(2);
  });

  // --- Format: none ---

  it("returns format 'none' with totalTasks=0 for plans with neither format", () => {
    const content = [
      "# Plan",
      "",
      "This is just prose describing what to do.",
      "",
      "No checkboxes, no task headings.",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("none");
    expect(result.totalTasks).toBe(0);
  });

  it("returns format 'none' for empty content", () => {
    const result = detectPlanFormat("");
    expect(result.format).toBe("none");
    expect(result.totalTasks).toBe(0);
  });

  // --- Frontmatter stripping ---

  it("strips YAML frontmatter before detecting format", () => {
    const content = [
      "---",
      "source: github",
      "issue: 42",
      "---",
      "",
      "# Plan",
      "",
      "- [ ] First checkbox",
      "- [ ] Second checkbox",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("checkboxes");
    expect(result.totalTasks).toBe(2);
  });

  it("strips frontmatter with task-like content that should not be counted", () => {
    // Ensure frontmatter doesn't accidentally match task heading patterns
    const content = [
      "---",
      "title: ### Task 1 fake heading",
      "---",
      "",
      "# Plan",
      "",
      "Just prose, no real tasks.",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("none");
    expect(result.totalTasks).toBe(0);
  });

  it("handles content with no frontmatter markers correctly", () => {
    const content = "# Plan\n\n### Task 1: Do it\n";
    const result = detectPlanFormat(content);
    expect(result.format).toBe("tasks");
    expect(result.totalTasks).toBe(1);
  });

  // --- GitHub issue plans (checkbox format) ---

  it("detects checkboxes format for GitHub issue plans", () => {
    const content = [
      "---",
      "source: github",
      "issue: 163",
      "issue-url: https://github.com/user/repo/issues/163",
      "---",
      "",
      "# feat: core format detection",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] detectPlanFormat returns correct format",
      "- [ ] countPlanTasks returns undefined for empty",
      "- [x] detection priority works",
      "- [ ] dashboard shows correct count",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("checkboxes");
    expect(result.totalTasks).toBe(4);
  });

  // --- Edge cases ---

  it("does not match indented checkboxes (nested lists)", () => {
    // Only top-level checkboxes (no leading whitespace) should match
    const content = [
      "# Plan",
      "",
      "  - [ ] indented checkbox",
      "    - [x] deeply indented",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("none");
    expect(result.totalTasks).toBe(0);
  });

  it("does not match task headings at wrong heading level", () => {
    const content = [
      "# Task 1: H1 level",
      "## Task 2: H2 level",
      "#### Task 3: H4 level",
    ].join("\n");

    const result = detectPlanFormat(content);
    expect(result.format).toBe("none");
    expect(result.totalTasks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countPlanTasksFromContent
// ---------------------------------------------------------------------------

describe("countPlanTasksFromContent", () => {
  it("returns count for task headings", () => {
    const content = "# Plan\n\n### Task 1: A\n\n### Task 2: B\n";
    expect(countPlanTasksFromContent(content)).toBe(2);
  });

  it("returns count for checkboxes", () => {
    const content = "# Plan\n\n- [ ] A\n- [x] B\n- [ ] C\n";
    expect(countPlanTasksFromContent(content)).toBe(3);
  });

  it("returns undefined for no tasks", () => {
    const content = "# Plan\n\nJust prose.\n";
    expect(countPlanTasksFromContent(content)).toBeUndefined();
  });

  it("returns undefined for empty content", () => {
    expect(countPlanTasksFromContent("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countCompletedFromProgress
// ---------------------------------------------------------------------------

describe("countCompletedFromProgress", () => {
  // --- Checkboxes format ---

  it("counts checked [x] items for checkboxes format", () => {
    const content = [
      "- [x] First done",
      "- [ ] Still pending",
      "- [x] Also done",
      "- [x] Third done",
    ].join("\n");

    expect(countCompletedFromProgress(content, "checkboxes")).toBe(3);
  });

  it("returns 0 for checkboxes format with no checked items", () => {
    const content = ["- [ ] Pending A", "- [ ] Pending B"].join("\n");

    expect(countCompletedFromProgress(content, "checkboxes")).toBe(0);
  });

  it("returns 0 for checkboxes format with empty content", () => {
    expect(countCompletedFromProgress("", "checkboxes")).toBe(0);
  });

  it("does not count unchecked [ ] items for checkboxes format", () => {
    const content = ["- [x] Done", "- [ ] Pending", "- [x] Also done"].join(
      "\n",
    );

    expect(countCompletedFromProgress(content, "checkboxes")).toBe(2);
  });

  // --- Tasks format: individual markers ---

  it("counts Status Complete markers for tasks format", () => {
    const content = [
      "### Task 1: First",
      "**Status:** Complete",
      "",
      "### Task 2: Second",
      "**Status:** Complete",
    ].join("\n");

    expect(countCompletedFromProgress(content, "tasks")).toBe(2);
  });

  it("counts Status Complete markers case-insensitively", () => {
    const content = [
      "**Status:** complete",
      "**Status:** COMPLETE",
      "**status:** Complete",
    ].join("\n");

    expect(countCompletedFromProgress(content, "tasks")).toBe(3);
  });

  it("returns 0 for tasks format with empty content", () => {
    expect(countCompletedFromProgress("", "tasks")).toBe(0);
  });

  // --- Tasks format: deprecated batch headings ---

  it("counts batch heading Tasks X-Y when no individual markers exist", () => {
    const content = "### Tasks 1-3: Batch work\nDid things.\n";
    expect(countCompletedFromProgress(content, "tasks")).toBe(3);
  });

  it("counts batch heading with en-dash", () => {
    const content = "### Tasks 5\u20138: Later batch\n";
    expect(countCompletedFromProgress(content, "tasks")).toBe(4);
  });

  // --- Double-counting fix: individual markers take precedence ---

  it("individual markers take precedence over batch headings (no double-counting)", () => {
    const content = [
      "### Tasks 1-3: Batch heading",
      "**Status:** Complete",
      "",
      "### Task 4: Individual",
      "**Status:** Complete",
    ].join("\n");

    // Should count 2 individual markers, NOT 2 + 3 = 5
    expect(countCompletedFromProgress(content, "tasks")).toBe(2);
  });

  it("batch headings used only when no individual markers exist", () => {
    const content = [
      "### Tasks 1-5: Legacy batch",
      "Completed a bunch of work.",
    ].join("\n");

    expect(countCompletedFromProgress(content, "tasks")).toBe(5);
  });

  // --- Format "none" falls back to tasks counting ---

  it("uses tasks counting strategy for 'none' format", () => {
    const content = ["### Task 1: Something", "**Status:** Complete"].join(
      "\n",
    );

    expect(countCompletedFromProgress(content, "none")).toBe(1);
  });

  it("returns 0 for 'none' format with no markers", () => {
    expect(countCompletedFromProgress("Just prose.", "none")).toBe(0);
  });

  // --- Checkboxes format ignores Status markers ---

  it("checkboxes format ignores Status Complete markers", () => {
    const content = [
      "- [x] Done task",
      "**Status:** Complete",
      "- [ ] Pending task",
    ].join("\n");

    // Only counts [x], not Status markers
    expect(countCompletedFromProgress(content, "checkboxes")).toBe(1);
  });
});

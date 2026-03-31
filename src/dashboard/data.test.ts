import { describe, it, expect } from "bun:test";
import { parseReceiptFromContent } from "./data.ts";

// ---------------------------------------------------------------------------
// parseReceiptFromContent
// ---------------------------------------------------------------------------

describe("parseReceiptFromContent", () => {
  it("parses a complete receipt", () => {
    const content = [
      "started_at=2025-06-15T10:30:00Z",
      "worktree_path=/tmp/wt",
      "branch=feat/dark-mode",
      "slug=dark-mode",
      "tasks_completed=3",
      "outcome=success",
    ].join("\n");

    const result = parseReceiptFromContent(content);
    expect(result.tasksCompleted).toBe(3);
    expect(result.outcome).toBe("success");
    expect(result.startedAt).toBe("2025-06-15T10:30:00Z");
    expect(result.branch).toBe("feat/dark-mode");
    expect(result.worktreePath).toBe("/tmp/wt");
    expect(result.receiptSource).toBe("worktree");
  });

  it("returns tasksCompleted: 0 when tasks_completed line is missing", () => {
    const content = [
      "started_at=2025-01-01T00:00:00Z",
      "branch=main",
      "slug=test",
    ].join("\n");

    const result = parseReceiptFromContent(content);
    expect(result.tasksCompleted).toBe(0);
  });

  it("returns tasksCompleted: 0 for non-numeric tasks_completed", () => {
    const content = [
      "started_at=2025-01-01T00:00:00Z",
      "branch=main",
      "slug=test",
      "tasks_completed=abc",
    ].join("\n");

    const result = parseReceiptFromContent(content);
    expect(result.tasksCompleted).toBe(0);
  });
});

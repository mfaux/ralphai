import { describe, it, expect } from "bun:test";
import {
  formatLearningsForPrompt,
  formatLearningsForPr,
  formatContextForPrompt,
  formatContextForPr,
} from "./learnings.ts";

// ---------------------------------------------------------------------------
// formatLearningsForPrompt
// ---------------------------------------------------------------------------

describe("formatLearningsForPrompt", () => {
  it("returns empty string for empty list", () => {
    expect(formatLearningsForPrompt([])).toBe("");
  });

  it("formats a single learning as a bullet with advisory framing", () => {
    const result = formatLearningsForPrompt(["Always run tests before commit"]);
    expect(result).toContain("## Learnings from previous iterations");
    expect(result).toContain("Treat these as guidance, not ground truth.");
    expect(result).toContain("- Always run tests before commit");
  });

  it("formats multiple learnings as bullets", () => {
    const result = formatLearningsForPrompt([
      "Use path.join for cross-platform paths",
      "Bun test runner lacks vi.setSystemTime",
    ]);
    expect(result).toContain("- Use path.join for cross-platform paths");
    expect(result).toContain("- Bun test runner lacks vi.setSystemTime");
  });
});

// ---------------------------------------------------------------------------
// formatLearningsForPr
// ---------------------------------------------------------------------------

describe("formatLearningsForPr", () => {
  it("returns empty string for empty list", () => {
    expect(formatLearningsForPr([])).toBe("");
  });

  it("returns a ## Learnings section with bullets for non-empty list", () => {
    const result = formatLearningsForPr([
      "Always validate config before writing.",
      "Use conventional commits consistently.",
    ]);
    expect(result).toBe(
      [
        "## Learnings",
        "",
        "- Always validate config before writing.",
        "- Use conventional commits consistently.",
      ].join("\n"),
    );
  });

  it("formats a single learning correctly", () => {
    const result = formatLearningsForPr(["Single lesson learned."]);
    expect(result).toContain("## Learnings");
    expect(result).toContain("- Single lesson learned.");
  });
});

// ---------------------------------------------------------------------------
// formatContextForPrompt
// ---------------------------------------------------------------------------

describe("formatContextForPrompt", () => {
  it("returns empty string for empty list", () => {
    expect(formatContextForPrompt([])).toBe("");
  });

  it("formats a single context note with advisory framing", () => {
    const result = formatContextForPrompt(["Refactored auth module"]);
    expect(result).toContain("## Context from previous iterations");
    expect(result).toContain(
      "These notes describe decisions, state, and intent from earlier work",
    );
    expect(result).toContain("- Refactored auth module");
  });

  it("formats multiple context notes as bullets", () => {
    const result = formatContextForPrompt([
      "Switched to JWT tokens",
      "Database migration pending",
    ]);
    expect(result).toContain("- Switched to JWT tokens");
    expect(result).toContain("- Database migration pending");
  });
});

// ---------------------------------------------------------------------------
// formatContextForPr
// ---------------------------------------------------------------------------

describe("formatContextForPr", () => {
  it("returns empty string for empty list", () => {
    expect(formatContextForPr([])).toBe("");
  });

  it("returns a <details> block with summary for a single note", () => {
    const result = formatContextForPr(["Applied workaround for flaky test"]);
    expect(result).toContain("<details><summary>Session context</summary>");
    expect(result).toContain("- Applied workaround for flaky test");
    expect(result).toContain("</details>");
  });

  it("returns both items as bullets inside the details block", () => {
    const result = formatContextForPr([
      "Skipped migration step — already applied",
      "Used feature flag for gradual rollout",
    ]);
    expect(result).toBe(
      [
        "<details><summary>Session context</summary>",
        "",
        "- Skipped migration step — already applied",
        "- Used feature flag for gradual rollout",
        "",
        "</details>",
      ].join("\n"),
    );
  });
});

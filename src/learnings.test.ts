import { describe, it, expect } from "bun:test";
import { formatLearningsForPrompt, formatLearningsForPr } from "./learnings.ts";

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

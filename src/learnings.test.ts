import { describe, it, expect } from "bun:test";
import {
  parseLearningContent,
  formatLearningsForPrompt,
  formatLearningsForPr,
} from "./learnings.ts";

// ---------------------------------------------------------------------------
// parseLearningContent
// ---------------------------------------------------------------------------

describe("parseLearningContent", () => {
  it('returns null for "none" (lowercase)', () => {
    expect(parseLearningContent("none")).toBeNull();
  });

  it('returns null for "None" (mixed case)', () => {
    expect(parseLearningContent("None")).toBeNull();
  });

  it('returns null for "NONE" (uppercase)', () => {
    expect(parseLearningContent("NONE")).toBeNull();
  });

  it('returns null for "none" with surrounding whitespace', () => {
    expect(parseLearningContent("  none  ")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLearningContent("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseLearningContent("   \n\t  ")).toBeNull();
  });

  it("returns trimmed prose for non-none content", () => {
    const result = parseLearningContent(
      "  The build fails when running on Windows due to path separators.  ",
    );
    expect(result).toBe(
      "The build fails when running on Windows due to path separators.",
    );
  });

  it("returns multiline prose as trimmed text", () => {
    const block = [
      "",
      "  First line of learning.",
      "  Second line of learning.",
      "",
    ].join("\n");
    const result = parseLearningContent(block);
    expect(result).toBe("First line of learning.\n  Second line of learning.");
  });

  it("preserves internal structure of prose", () => {
    const block =
      "Always use path.join() for cross-platform paths.\nNever hardcode / separators.";
    expect(parseLearningContent(block)).toBe(block);
  });
});

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

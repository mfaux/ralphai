/**
 * Tests for progress and sentinel helpers absorbed into src/runner.ts.
 */
import { describe, it, expect } from "bun:test";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  appendProgressBlock,
  generateNonce,
  detectCompletion,
  extractNoncedBlock,
  parseLearningContent,
} from "./runner.ts";

// ---------------------------------------------------------------------------
// appendProgressBlock
// ---------------------------------------------------------------------------

describe("appendProgressBlock", () => {
  const ctx = useTempDir();

  it("appends to existing progress file with task header", () => {
    const file = join(ctx.dir, "progress.md");
    writeFileSync(file, "## Progress Log\n\n");

    appendProgressBlock(file, 1, "### Task 1: Done\n**Status:** Complete");

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("## Progress Log");
    expect(content).toContain("### Iteration 1");
    expect(content).toContain("### Task 1: Done");
    expect(content).toContain("**Status:** Complete");
  });

  it("creates file with seed header when it does not exist", () => {
    const file = join(ctx.dir, "new-progress.md");

    appendProgressBlock(file, 3, "Some progress content");

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("## Progress Log");
    expect(content).toContain("### Iteration 3");
    expect(content).toContain("Some progress content");
  });

  it("appends multiple tasks sequentially", () => {
    const file = join(ctx.dir, "multi.md");
    writeFileSync(file, "## Progress Log\n\n");

    appendProgressBlock(file, 1, "First task work");
    appendProgressBlock(file, 2, "Second task work");

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("### Iteration 1");
    expect(content).toContain("First task work");
    expect(content).toContain("### Iteration 2");
    expect(content).toContain("Second task work");
  });
});

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe("generateNonce", () => {
  it("returns a non-empty string", () => {
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("returns unique values on successive calls", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// detectCompletion
// ---------------------------------------------------------------------------

describe("detectCompletion", () => {
  const nonce = "test-nonce-abc123";

  it("does NOT detect bare <promise>COMPLETE</promise> without nonce", () => {
    const output = [
      "Running tests...",
      "  ✓ echoes <promise>COMPLETE</promise> when done",
      "  ✓ other test",
      "All tests passed.",
    ].join("\n");
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it("does NOT detect bare sentinel embedded in test runner output", () => {
    const output = [
      "bun test v1.0.0",
      "",
      "src/runner.test.ts:",
      "  ✓ archives plan when agent outputs <promise>COMPLETE</promise> [5ms]",
      "",
      "  3 pass | 0 fail",
    ].join("\n");
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it('detects nonce-stamped <promise nonce="...">COMPLETE</promise>', () => {
    const output = [
      "I have finished all the work.",
      `<promise nonce="${nonce}">COMPLETE</promise>`,
      "<learnings>none</learnings>",
    ].join("\n");
    expect(detectCompletion(output, nonce)).toBe(true);
  });

  it("detects nonce-stamped sentinel with surrounding whitespace", () => {
    const output = `  \n  <promise nonce="${nonce}">COMPLETE</promise>  \n  `;
    expect(detectCompletion(output, nonce)).toBe(true);
  });

  it("does NOT detect sentinel with wrong nonce", () => {
    const output = `<promise nonce="wrong-nonce-xyz">COMPLETE</promise>`;
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it("does NOT detect sentinel with partial nonce match", () => {
    const output = `<promise nonce="test-nonce-abc">COMPLETE</promise>`;
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it("does NOT detect sentinel with nonce embedded as substring of longer value", () => {
    const output = `<promise nonce="${nonce}-extra">COMPLETE</promise>`;
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it("returns false for empty output", () => {
    expect(detectCompletion("", nonce)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractNoncedBlock
// ---------------------------------------------------------------------------

describe("extractNoncedBlock", () => {
  const nonce = "extract-nonce-456";

  it("extracts content from nonce-stamped <learnings> block", () => {
    const output = [
      "some output",
      `<learnings nonce="${nonce}">`,
      "Always run tests before committing.",
      "</learnings>",
    ].join("\n");
    expect(extractNoncedBlock(output, "learnings", nonce)).toBe(
      "Always run tests before committing.",
    );
  });

  it("ignores bare <learnings> block (no nonce)", () => {
    const output = [
      "<learnings>",
      "This is from test output, not the agent.",
      "</learnings>",
    ].join("\n");
    expect(extractNoncedBlock(output, "learnings", nonce)).toBeNull();
  });

  it("ignores <learnings> block with wrong nonce", () => {
    const output = [
      '<learnings nonce="wrong-nonce">',
      "Content with wrong nonce.",
      "</learnings>",
    ].join("\n");
    expect(extractNoncedBlock(output, "learnings", nonce)).toBeNull();
  });

  it("extracts content from nonce-stamped <progress> block", () => {
    const output = [
      `<progress nonce="${nonce}">`,
      "- [x] Added validation",
      "</progress>",
    ].join("\n");
    expect(extractNoncedBlock(output, "progress", nonce)).toBe(
      "- [x] Added validation",
    );
  });

  it("extracts content from nonce-stamped <pr-summary> block", () => {
    const output = `<pr-summary nonce="${nonce}">Implemented auth flow.</pr-summary>`;
    expect(extractNoncedBlock(output, "pr-summary", nonce)).toBe(
      "Implemented auth flow.",
    );
  });

  it("returns null when block is empty", () => {
    const output = `<learnings nonce="${nonce}"></learnings>`;
    expect(extractNoncedBlock(output, "learnings", nonce)).toBeNull();
  });

  it("returns null when block contains only whitespace", () => {
    const output = `<learnings nonce="${nonce}">   \n  </learnings>`;
    expect(extractNoncedBlock(output, "learnings", nonce)).toBeNull();
  });

  it("returns null when no matching block exists", () => {
    expect(
      extractNoncedBlock("just regular output", "learnings", nonce),
    ).toBeNull();
  });

  it("returns null when only opening tag exists", () => {
    const output = `<learnings nonce="${nonce}">content without closing tag`;
    expect(extractNoncedBlock(output, "learnings", nonce)).toBeNull();
  });

  it("extracts multi-line content", () => {
    const output = [
      `<pr-summary nonce="${nonce}">`,
      "Add JWT-based authentication with login/logout endpoints,",
      "replacing the previous cookie-based session system.",
      "</pr-summary>",
    ].join("\n");
    expect(extractNoncedBlock(output, "pr-summary", nonce)).toBe(
      "Add JWT-based authentication with login/logout endpoints,\nreplacing the previous cookie-based session system.",
    );
  });

  it("extracts only the first matching nonce-stamped block", () => {
    const output = [
      `<learnings nonce="${nonce}">first block</learnings>`,
      `<learnings nonce="${nonce}">second block</learnings>`,
    ].join("\n");
    expect(extractNoncedBlock(output, "learnings", nonce)).toBe("first block");
  });
});

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

  // <entry> tag stripping behavior
  it('returns null for <entry> with whitespace around "status: none"', () => {
    expect(parseLearningContent("<entry>  status: none  </entry>")).toBeNull();
  });

  it("returns null when all entries are status: none", () => {
    expect(
      parseLearningContent(
        "<entry>status: none</entry><entry>status: none</entry>",
      ),
    ).toBeNull();
  });

  it("extracts real content and ignores status: none entries", () => {
    expect(parseLearningContent("<entry>Real lesson here.</entry>none")).toBe(
      "Real lesson here.",
    );
  });

  it("returns content from a single <entry> with real content", () => {
    expect(
      parseLearningContent(
        "<entry>The mock.module pattern requires all exports.</entry>",
      ),
    ).toBe("The mock.module pattern requires all exports.");
  });

  it("returns null for STATUS: NONE (case-insensitive) inside <entry>", () => {
    expect(parseLearningContent("<entry>STATUS: NONE</entry>")).toBeNull();
  });

  it("joins multiple real entries with newline", () => {
    expect(
      parseLearningContent(
        "<entry>First lesson.</entry><entry>Second lesson.</entry>",
      ),
    ).toBe("First lesson.\nSecond lesson.");
  });
});

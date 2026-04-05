import { describe, it, expect } from "bun:test";
import {
  detectCompletion,
  generateNonce,
  extractNoncedBlock,
} from "./sentinel.ts";

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

  // TDD Cycle 1: bare sentinel in tool output must NOT trigger completion
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

  // TDD Cycle 2: correct nonce-stamped sentinel IS detected
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

  // TDD Cycle 3: wrong nonce does NOT trigger completion
  it("does NOT detect sentinel with wrong nonce", () => {
    const output = `<promise nonce="wrong-nonce-xyz">COMPLETE</promise>`;
    expect(detectCompletion(output, nonce)).toBe(false);
  });

  it("does NOT detect sentinel with partial nonce match", () => {
    // Ensure substring matching doesn't work (e.g., nonce="test-nonce-abc" vs "test-nonce-abc123")
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
// extractNoncedBlock — generic nonce-aware tag extraction
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

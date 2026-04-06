import { describe, it, expect } from "bun:test";
import {
  detectFeedbackScope,
  extractRelevantFiles,
  commonParentDir,
} from "./scope-detection.ts";

// ---------------------------------------------------------------------------
// extractRelevantFiles() unit tests
// ---------------------------------------------------------------------------

describe("extractRelevantFiles", () => {
  it("extracts backtick-wrapped file paths from ## Relevant Files", () => {
    const content = [
      "# Plan",
      "",
      "## Relevant Files",
      "",
      "- `src/foo/bar.ts`",
      "- `src/foo/baz.ts`",
      "",
      "## What to build",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual([
      "src/foo/bar.ts",
      "src/foo/baz.ts",
    ]);
  });

  it("extracts paths with descriptions after dash separator", () => {
    const content = [
      "## Relevant Files",
      "",
      "- `src/foo/bar.ts` — main entry point",
      "- `src/foo/baz.ts` - helper module",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual([
      "src/foo/bar.ts",
      "src/foo/baz.ts",
    ]);
  });

  it("extracts bare file paths (no backticks)", () => {
    const content = [
      "## Relevant Files",
      "",
      "- src/components/Button.tsx",
      "- src/components/Input.tsx",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual([
      "src/components/Button.tsx",
      "src/components/Input.tsx",
    ]);
  });

  it("returns empty array when no ## Relevant Files section", () => {
    const content = [
      "# Plan",
      "",
      "## What to build",
      "",
      "Some description.",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual([]);
  });

  it("stops at the next heading", () => {
    const content = [
      "## Relevant Files",
      "",
      "- `src/foo.ts`",
      "",
      "## Acceptance criteria",
      "",
      "- `tests/bar.ts`",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual(["src/foo.ts"]);
  });

  it("handles asterisk list markers", () => {
    const content = [
      "## Relevant Files",
      "",
      "* `src/a.ts`",
      "* `lib/b.ts`",
      "",
    ].join("\n");
    expect(extractRelevantFiles(content)).toEqual(["src/a.ts", "lib/b.ts"]);
  });

  it("handles section at end of file without trailing heading", () => {
    const content = ["## Relevant Files", "", "- `src/only.ts`"].join("\n");
    expect(extractRelevantFiles(content)).toEqual(["src/only.ts"]);
  });
});

// ---------------------------------------------------------------------------
// commonParentDir() unit tests
// ---------------------------------------------------------------------------

describe("commonParentDir", () => {
  it("returns common parent for files in the same directory", () => {
    expect(commonParentDir(["src/foo/bar.ts", "src/foo/baz.ts"])).toBe(
      "src/foo",
    );
  });

  it("returns empty string for files in unrelated directories", () => {
    expect(commonParentDir(["src/a.ts", "lib/b.ts"])).toBe("");
  });

  it("returns the parent directory of a single file", () => {
    expect(commonParentDir(["src/components/Button.tsx"])).toBe(
      "src/components",
    );
  });

  it("returns empty string for empty input", () => {
    expect(commonParentDir([])).toBe("");
  });

  it("returns common ancestor for files at different depths", () => {
    expect(
      commonParentDir(["src/utils/helpers/format.ts", "src/utils/index.ts"]),
    ).toBe("src/utils");
  });

  it("returns common parent when all files share a deep path", () => {
    expect(
      commonParentDir([
        "packages/core/src/a.ts",
        "packages/core/src/b.ts",
        "packages/core/src/c.ts",
      ]),
    ).toBe("packages/core/src");
  });

  it("returns empty string for root-level files", () => {
    expect(commonParentDir(["README.md", "package.json"])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// detectFeedbackScope() unit tests
// ---------------------------------------------------------------------------

describe("detectFeedbackScope", () => {
  it("returns common parent from multiple files in same directory", () => {
    const content = [
      "# Plan",
      "",
      "## Relevant Files",
      "",
      "- `src/foo/bar.ts`",
      "- `src/foo/baz.ts`",
      "",
    ].join("\n");
    expect(detectFeedbackScope(content)).toBe("src/foo");
  });

  it("returns empty string when files span unrelated directories", () => {
    const content = [
      "## Relevant Files",
      "",
      "- `src/a.ts`",
      "- `lib/b.ts`",
      "",
    ].join("\n");
    expect(detectFeedbackScope(content)).toBe("");
  });

  it("returns parent directory for a single file", () => {
    const content = [
      "## Relevant Files",
      "",
      "- `src/components/Button.tsx`",
      "",
    ].join("\n");
    expect(detectFeedbackScope(content)).toBe("src/components");
  });

  it("returns empty string when no ## Relevant Files section", () => {
    const content = [
      "# Plan",
      "",
      "## What to build",
      "",
      "Some description.",
      "",
    ].join("\n");
    expect(detectFeedbackScope(content)).toBe("");
  });

  it("returns empty string for empty plan content", () => {
    expect(detectFeedbackScope("")).toBe("");
  });
});

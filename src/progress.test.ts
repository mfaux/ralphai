import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { extractProgressBlock, appendProgressBlock } from "./progress.ts";

// ---------------------------------------------------------------------------
// extractProgressBlock
// ---------------------------------------------------------------------------

describe("extractProgressBlock", () => {
  it("extracts content between <progress> tags", () => {
    const text = "Some output\n<progress>\n### Task 1: Done\n</progress>\nMore";
    expect(extractProgressBlock(text)).toBe("### Task 1: Done");
  });

  it("returns null when no <progress> block present", () => {
    expect(extractProgressBlock("just some agent output")).toBeNull();
  });

  it("returns null for empty block", () => {
    expect(extractProgressBlock("<progress>\n\n</progress>")).toBeNull();
  });

  it("returns null for whitespace-only block", () => {
    expect(extractProgressBlock("<progress>   \n  \n</progress>")).toBeNull();
  });

  it("returns null when opening tag exists but no closing tag", () => {
    expect(extractProgressBlock("<progress>\nsome content")).toBeNull();
  });

  it("returns null when only closing tag exists", () => {
    expect(extractProgressBlock("some content</progress>")).toBeNull();
  });

  it("extracts multi-line content", () => {
    const text = [
      "output before",
      "<progress>",
      "### Task 1: Add feature",
      "**Status:** Complete",
      "Added the new module.",
      "</progress>",
      "output after",
    ].join("\n");
    const result = extractProgressBlock(text);
    expect(result).toContain("### Task 1: Add feature");
    expect(result).toContain("**Status:** Complete");
    expect(result).toContain("Added the new module.");
  });

  it("extracts only the first block when multiple exist", () => {
    const text = [
      "<progress>first block</progress>",
      "<progress>second block</progress>",
    ].join("\n");
    expect(extractProgressBlock(text)).toBe("first block");
  });

  it("handles nested-looking tags gracefully", () => {
    // The inner </progress> ends the extraction
    const text = "<progress>outer <progress>inner</progress> rest</progress>";
    expect(extractProgressBlock(text)).toBe("outer <progress>inner");
  });
});

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
    expect(content).toContain("### Task 1");
    expect(content).toContain("### Task 1: Done");
    expect(content).toContain("**Status:** Complete");
  });

  it("creates file with seed header when it does not exist", () => {
    const file = join(ctx.dir, "new-progress.md");

    appendProgressBlock(file, 3, "Some progress content");

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("## Progress Log");
    expect(content).toContain("### Task 3");
    expect(content).toContain("Some progress content");
  });

  it("appends multiple tasks sequentially", () => {
    const file = join(ctx.dir, "multi.md");
    writeFileSync(file, "## Progress Log\n\n");

    appendProgressBlock(file, 1, "First task work");
    appendProgressBlock(file, 2, "Second task work");

    const content = readFileSync(file, "utf-8");
    expect(content).toContain("### Task 1");
    expect(content).toContain("First task work");
    expect(content).toContain("### Task 2");
    expect(content).toContain("Second task work");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mock } from "bun:test";

// Mock getRepoPipelineDirs to return our temp dirs without needing a git repo.
let mockPipelineDirs: {
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
};

mock.module("../global-state.ts", () => ({
  getRepoPipelineDirs: () => mockPipelineDirs,
  listAllRepos: () => [],
}));

// Now import the functions under test (after mock.module is declared).
const { loadOutputTail, loadOutputTailAsync } = await import("./data/index.ts");
import type { PlanInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counter to generate unique cwd keys, preventing cache collisions. */
let cwdCounter = 0;
function uniqueCwd(): string {
  return `/fake/output-cwd/${++cwdCounter}`;
}

function makePipelineDirs(base: string) {
  const backlogDir = join(base, "backlog");
  const wipDir = join(base, "in-progress");
  const archiveDir = join(base, "out");
  mkdirSync(backlogDir, { recursive: true });
  mkdirSync(wipDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  return { backlogDir, wipDir, archiveDir };
}

/** Generate a log file with `n` numbered lines. */
function generateLines(n: number, trailingNewline = true): string {
  const lines = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function writeOutput(slugDir: string, content: string): void {
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, "agent-output.log"), content);
}

// ---------------------------------------------------------------------------
// loadOutputTailAsync — byte-offset seeking
// ---------------------------------------------------------------------------

describe("loadOutputTailAsync", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralphai-output-tail-"));
    mockPipelineDirs = makePipelineDirs(tmpDir);
    cwd = uniqueCwd();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Large file (>200 lines) — only tail is returned
  // -----------------------------------------------------------------------

  it("returns only the last maxLines for a large file", async () => {
    const totalLineCount = 500;
    const content = generateLines(totalLineCount);
    const slugDir = join(mockPipelineDirs.wipDir, "large-plan");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "large-plan.md",
      slug: "large-plan",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();

    // The file has 500 lines of content + trailing newline = 501 segments
    // from split("\n") (last segment is empty string after trailing \n).
    expect(result!.totalLines).toBe(totalLineCount + 1);

    // Tail should be the last 200 lines (segments) joined by \n
    const resultLines = result!.content.split("\n");
    expect(resultLines.length).toBe(200);
    // First line of the tail should be line 302
    // (500 lines + 1 empty segment = 501 segments, last 200 = segments 301..500,
    //  which are "line 301" through "line 500" then "")
    expect(resultLines[0]).toBe("line 302");
    expect(resultLines[resultLines.length - 2]).toBe("line 500");
    expect(resultLines[resultLines.length - 1]).toBe("");
  });

  it("respects a custom maxLines value", async () => {
    const content = generateLines(50);
    const slugDir = join(mockPipelineDirs.wipDir, "custom-max");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "custom-max.md",
      slug: "custom-max",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan, 10);
    expect(result).not.toBeNull();
    expect(result!.totalLines).toBe(51); // 50 lines + trailing newline

    const resultLines = result!.content.split("\n");
    expect(resultLines.length).toBe(10);
    expect(resultLines[0]).toBe("line 42");
    expect(resultLines[resultLines.length - 2]).toBe("line 50");
    expect(resultLines[resultLines.length - 1]).toBe("");
  });

  // -----------------------------------------------------------------------
  // Small file (<200 lines) — full content returned
  // -----------------------------------------------------------------------

  it("returns full content for a small file", async () => {
    const content = generateLines(10);
    const slugDir = join(mockPipelineDirs.wipDir, "small-plan");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "small-plan.md",
      slug: "small-plan",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();
    expect(result!.content).toBe(content);
    expect(result!.totalLines).toBe(11); // 10 lines + trailing newline
  });

  // -----------------------------------------------------------------------
  // Empty file — returns empty content with totalLines 1
  // -----------------------------------------------------------------------

  it("returns empty content for an empty file", async () => {
    const slugDir = join(mockPipelineDirs.wipDir, "empty-plan");
    writeOutput(slugDir, "");

    const plan: PlanInfo = {
      filename: "empty-plan.md",
      slug: "empty-plan",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("");
    expect(result!.totalLines).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Nonexistent file — returns null
  // -----------------------------------------------------------------------

  it("returns null for a nonexistent file", async () => {
    const plan: PlanInfo = {
      filename: "ghost.md",
      slug: "ghost",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Exactly 200 lines — edge case
  // -----------------------------------------------------------------------

  it("returns full content when file has exactly maxLines lines", async () => {
    const content = generateLines(200);
    const slugDir = join(mockPipelineDirs.wipDir, "exact-plan");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "exact-plan.md",
      slug: "exact-plan",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();
    // 200 lines + trailing \n = 201 segments from split
    expect(result!.totalLines).toBe(201);
    // Content should be the full file since 201 segments > 200 maxLines
    // actually means only the last 200 segments are returned
    const resultLines = result!.content.split("\n");
    expect(resultLines.length).toBe(200);
    expect(resultLines[0]).toBe("line 2");
    expect(resultLines[resultLines.length - 1]).toBe("");
  });

  // -----------------------------------------------------------------------
  // File with no trailing newline
  // -----------------------------------------------------------------------

  it("handles a file with no trailing newline", async () => {
    const content = generateLines(10, false); // "line 1\nline 2\n...\nline 10"
    const slugDir = join(mockPipelineDirs.wipDir, "no-trail");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "no-trail.md",
      slug: "no-trail",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();
    expect(result!.content).toBe(content);
    expect(result!.totalLines).toBe(10);
  });

  it("handles large file with no trailing newline", async () => {
    const content = generateLines(300, false);
    const slugDir = join(mockPipelineDirs.wipDir, "no-trail-large");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "no-trail-large.md",
      slug: "no-trail-large",
      state: "in-progress",
    };

    const result = await loadOutputTailAsync(cwd, plan, 200);
    expect(result).not.toBeNull();
    expect(result!.totalLines).toBe(300);

    const resultLines = result!.content.split("\n");
    expect(resultLines.length).toBe(200);
    expect(resultLines[0]).toBe("line 101");
    expect(resultLines[resultLines.length - 1]).toBe("line 300");
  });

  // -----------------------------------------------------------------------
  // Backlog state — returns null
  // -----------------------------------------------------------------------

  it("returns null for backlog plans", async () => {
    const plan: PlanInfo = {
      filename: "backlog-plan.md",
      slug: "backlog-plan",
      state: "backlog",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Completed plan — reads from archive dir
  // -----------------------------------------------------------------------

  it("reads from archive dir for completed plans", async () => {
    const content = generateLines(5);
    const slugDir = join(mockPipelineDirs.archiveDir, "done-plan");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "done-plan.md",
      slug: "done-plan",
      state: "completed",
    };

    const result = await loadOutputTailAsync(cwd, plan);
    expect(result).not.toBeNull();
    expect(result!.content).toBe(content);
    expect(result!.totalLines).toBe(6);
  });

  // -----------------------------------------------------------------------
  // Consistency with sync version
  // -----------------------------------------------------------------------

  it("returns same result as sync loadOutputTail for small files", async () => {
    const content = generateLines(50);
    const slugDir = join(mockPipelineDirs.wipDir, "sync-check");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "sync-check.md",
      slug: "sync-check",
      state: "in-progress",
    };

    const syncResult = loadOutputTail(cwd, plan);
    const asyncResult = await loadOutputTailAsync(cwd, plan);

    expect(asyncResult).toEqual(syncResult);
  });

  it("returns same result as sync loadOutputTail for large files", async () => {
    const content = generateLines(500);
    const slugDir = join(mockPipelineDirs.wipDir, "sync-check-large");
    writeOutput(slugDir, content);

    const plan: PlanInfo = {
      filename: "sync-check-large.md",
      slug: "sync-check-large",
      state: "in-progress",
    };

    const syncResult = loadOutputTail(cwd, plan);
    const asyncResult = await loadOutputTailAsync(cwd, plan);

    expect(asyncResult).toEqual(syncResult);
  });
});

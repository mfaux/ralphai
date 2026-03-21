import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  extractLearningsBlock,
  parseLearningsEntry,
  appendLearningEntry,
  seedLearningCandidatesFile,
  pruneLearningsFile,
  processLearnings,
} from "./learnings.ts";
import type { LearningEntry } from "./learnings.ts";

// ---------------------------------------------------------------------------
// extractLearningsBlock
// ---------------------------------------------------------------------------

describe("extractLearningsBlock", () => {
  it("extracts content between <learnings> tags", () => {
    const text = [
      "Some agent output...",
      "<learnings>",
      "<entry>",
      "status: none",
      "</entry>",
      "</learnings>",
    ].join("\n");
    const block = extractLearningsBlock(text);
    expect(block).toContain("status: none");
    expect(block).toContain("<entry>");
  });

  it("returns null when no <learnings> tag is present", () => {
    expect(extractLearningsBlock("just regular output")).toBeNull();
  });

  it("returns null when only opening tag is present", () => {
    expect(extractLearningsBlock("<learnings>\nsome content")).toBeNull();
  });

  it("returns null when block is empty", () => {
    expect(extractLearningsBlock("<learnings>\n\n</learnings>")).toBeNull();
  });

  it("extracts only the first block when multiple exist", () => {
    const text = [
      "<learnings>",
      "<entry>",
      "status: none",
      "</entry>",
      "</learnings>",
      "<learnings>",
      "<entry>",
      "status: logged",
      "</entry>",
      "</learnings>",
    ].join("\n");
    const block = extractLearningsBlock(text);
    expect(block).toContain("status: none");
    expect(block).not.toContain("status: logged");
  });
});

// ---------------------------------------------------------------------------
// parseLearningsEntry
// ---------------------------------------------------------------------------

describe("parseLearningsEntry", () => {
  it("parses a 'none' status entry", () => {
    const block = "<entry>\nstatus: none\n</entry>";
    const entry = parseLearningsEntry(block);
    expect(entry).toEqual({ status: "none" });
  });

  it("parses a 'logged' entry with all fields", () => {
    const block = [
      "<entry>",
      "status: logged",
      "date: 2026-03-21",
      "title: Test title",
      "what: Something broke",
      "root_cause: Bad logic",
      "prevention: Add tests",
      "</entry>",
    ].join("\n");
    const entry = parseLearningsEntry(block);
    expect(entry).toEqual({
      status: "logged",
      date: "2026-03-21",
      title: "Test title",
      what: "Something broke",
      rootCause: "Bad logic",
      prevention: "Add tests",
    });
  });

  it("returns null when no <entry> tags exist", () => {
    expect(parseLearningsEntry("status: none")).toBeNull();
  });

  it("returns null when entry is empty", () => {
    expect(parseLearningsEntry("<entry></entry>")).toBeNull();
  });

  it("returns null when status is missing", () => {
    const block = "<entry>\ndate: 2026-03-21\n</entry>";
    expect(parseLearningsEntry(block)).toBeNull();
  });

  it("returns null for logged status with missing fields", () => {
    const block = [
      "<entry>",
      "status: logged",
      "date: 2026-03-21",
      "title: Incomplete",
      "</entry>",
    ].join("\n");
    expect(parseLearningsEntry(block)).toBeNull();
  });

  it("returns null for unknown status values", () => {
    const block = "<entry>\nstatus: unknown_value\n</entry>";
    expect(parseLearningsEntry(block)).toBeNull();
  });

  it("trims whitespace from field values", () => {
    const block = [
      "<entry>",
      "status: logged",
      "date:   2026-03-21  ",
      "title:  Spaced title  ",
      "what:  A problem  ",
      "root_cause:  The cause  ",
      "prevention:  The fix  ",
      "</entry>",
    ].join("\n");
    const entry = parseLearningsEntry(block);
    expect(entry?.date).toBe("2026-03-21");
    expect(entry?.title).toBe("Spaced title");
  });
});

// ---------------------------------------------------------------------------
// appendLearningEntry
// ---------------------------------------------------------------------------

describe("appendLearningEntry", () => {
  const ctx = useTempDir();

  const sampleEntry: LearningEntry = {
    status: "logged",
    date: "2026-03-21",
    title: "Test learning",
    what: "Something broke",
    rootCause: "Bad code",
    prevention: "Write tests",
  };

  it("creates the file with seed header when it doesn't exist", () => {
    const filePath = join(ctx.dir, ".ralphai", "LEARNINGS.md");
    appendLearningEntry(filePath, sampleEntry);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Ralphai Learnings");
    expect(content).toContain("### 2026-03-21 — Test learning");
  });

  it("appends entry to existing file", () => {
    const filePath = join(ctx.dir, "LEARNINGS.md");
    writeFileSync(filePath, "# Existing header\n");
    appendLearningEntry(filePath, sampleEntry);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Existing header");
    expect(content).toContain("### 2026-03-21 — Test learning");
    expect(content).toContain("**What went wrong:** Something broke");
    expect(content).toContain("**Root cause:** Bad code");
    expect(content).toContain("**Fix / Prevention:** Write tests");
  });

  it("formats entry with correct Markdown structure", () => {
    const filePath = join(ctx.dir, "LEARNINGS.md");
    writeFileSync(filePath, "# Header\n");
    appendLearningEntry(filePath, sampleEntry);
    const content = readFileSync(filePath, "utf-8");
    // Verify the entry has the expected structure with blank lines
    expect(content).toMatch(
      /### 2026-03-21 — Test learning\n\n\*\*What went wrong:\*\*/,
    );
  });
});

// ---------------------------------------------------------------------------
// seedLearningCandidatesFile
// ---------------------------------------------------------------------------

describe("seedLearningCandidatesFile", () => {
  const ctx = useTempDir();

  it("creates the file with seed header when missing", () => {
    const filePath = join(ctx.dir, ".ralphai", "LEARNING_CANDIDATES.md");
    seedLearningCandidatesFile(filePath);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Ralphai Learning Candidates");
    expect(content).toContain("Potential durable lessons");
  });

  it("does not overwrite an existing file", () => {
    const filePath = join(ctx.dir, "LEARNING_CANDIDATES.md");
    writeFileSync(filePath, "# My custom content\n");
    seedLearningCandidatesFile(filePath);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("# My custom content\n");
  });
});

// ---------------------------------------------------------------------------
// pruneLearningsFile
// ---------------------------------------------------------------------------

describe("pruneLearningsFile", () => {
  const ctx = useTempDir();

  /** Build a learnings file with N entries and a header. */
  function buildFile(dir: string, entryCount: number): string {
    const filePath = join(dir, "LEARNINGS.md");
    const header = "# Learnings\n\nSome header text.\n\n---\n\n";
    const entries = Array.from({ length: entryCount }, (_, i) => {
      const n = i + 1;
      return [
        `### 2026-03-${String(n).padStart(2, "0")} — Entry ${n}`,
        "",
        `**What went wrong:** Problem ${n}`,
        "",
        `**Root cause:** Cause ${n}`,
        "",
        `**Fix / Prevention:** Fix ${n}`,
      ].join("\n");
    });
    writeFileSync(filePath, header + entries.join("\n\n") + "\n", "utf-8");
    return filePath;
  }

  it("is a no-op when file has fewer entries than the limit", () => {
    const filePath = buildFile(ctx.dir, 3);
    const before = readFileSync(filePath, "utf-8");
    pruneLearningsFile(filePath, 5);
    const after = readFileSync(filePath, "utf-8");
    expect(after).toBe(before);
  });

  it("is a no-op when file doesn't exist", () => {
    // Should not throw
    pruneLearningsFile(join(ctx.dir, "nonexistent.md"), 5);
  });

  it("keeps exactly maxEntries when file exceeds the limit", () => {
    const filePath = buildFile(ctx.dir, 5);
    pruneLearningsFile(filePath, 3);
    const content = readFileSync(filePath, "utf-8");
    // Should keep entries 3, 4, 5 (the most recent)
    expect(content).not.toContain("Entry 1");
    expect(content).not.toContain("Entry 2");
    expect(content).toContain("Entry 3");
    expect(content).toContain("Entry 4");
    expect(content).toContain("Entry 5");
  });

  it("preserves the file header after pruning", () => {
    const filePath = buildFile(ctx.dir, 5);
    pruneLearningsFile(filePath, 2);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Learnings");
    expect(content).toContain("Some header text.");
  });

  it("is a no-op when maxEntries is 0", () => {
    const filePath = buildFile(ctx.dir, 3);
    const before = readFileSync(filePath, "utf-8");
    pruneLearningsFile(filePath, 0);
    const after = readFileSync(filePath, "utf-8");
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// processLearnings (integration)
// ---------------------------------------------------------------------------

describe("processLearnings", () => {
  const ctx = useTempDir();

  function paths() {
    return {
      learnings: join(ctx.dir, ".ralphai", "LEARNINGS.md"),
      candidates: join(ctx.dir, ".ralphai", "LEARNING_CANDIDATES.md"),
    };
  }

  it("returns no-block when agent output has no learnings", () => {
    const { learnings, candidates } = paths();
    const result = processLearnings("just output", learnings, candidates);
    expect(result.outcome).toBe("no-block");
    expect(result.message).toContain("No <learnings> block");
  });

  it("returns malformed when block cannot be parsed", () => {
    const { learnings, candidates } = paths();
    const output = "<learnings>\ngarbage data\n</learnings>";
    const result = processLearnings(output, learnings, candidates);
    expect(result.outcome).toBe("malformed");
    expect(result.message).toContain("Malformed");
  });

  it("returns none when status is none", () => {
    const { learnings, candidates } = paths();
    const output = [
      "<learnings>",
      "<entry>",
      "status: none",
      "</entry>",
      "</learnings>",
    ].join("\n");
    const result = processLearnings(output, learnings, candidates);
    expect(result.outcome).toBe("none");
    expect(result.message).toContain("No learning logged");
  });

  it("logs entry and returns logged outcome", () => {
    const { learnings, candidates } = paths();
    const output = [
      "Agent did some work...",
      "<learnings>",
      "<entry>",
      "status: logged",
      "date: 2026-03-21",
      "title: Something important",
      "what: It broke",
      "root_cause: Bad logic",
      "prevention: Add tests",
      "</entry>",
      "</learnings>",
    ].join("\n");
    const result = processLearnings(output, learnings, candidates);
    expect(result.outcome).toBe("logged");
    expect(result.message).toContain("Something important");

    // Verify file was written
    const content = readFileSync(learnings, "utf-8");
    expect(content).toContain("### 2026-03-21 — Something important");
    expect(content).toContain("**What went wrong:** It broke");
  });

  it("seeds candidates file even when no learnings block exists", () => {
    const { learnings, candidates } = paths();
    processLearnings("no block", learnings, candidates);
    expect(existsSync(candidates)).toBe(true);
    const content = readFileSync(candidates, "utf-8");
    expect(content).toContain("# Ralphai Learning Candidates");
  });

  it("prunes learnings file when it exceeds max entries", () => {
    const { learnings, candidates } = paths();

    // Pre-populate with entries
    mkdirSync(join(ctx.dir, ".ralphai"), { recursive: true });
    const header = "# Ralphai Learnings\n\n---\n\n";
    const entries = Array.from({ length: 3 }, (_, i) => {
      return [
        `### 2026-03-0${i + 1} — Old entry ${i + 1}`,
        "",
        `**What went wrong:** Old problem ${i + 1}`,
        "",
        `**Root cause:** Old cause ${i + 1}`,
        "",
        `**Fix / Prevention:** Old fix ${i + 1}`,
      ].join("\n");
    });
    writeFileSync(learnings, header + entries.join("\n\n") + "\n", "utf-8");

    // Process a new entry with maxLearnings=3
    const output = [
      "<learnings>",
      "<entry>",
      "status: logged",
      "date: 2026-03-21",
      "title: New entry",
      "what: New problem",
      "root_cause: New cause",
      "prevention: New fix",
      "</entry>",
      "</learnings>",
    ].join("\n");

    processLearnings(output, learnings, candidates, 3);

    const content = readFileSync(learnings, "utf-8");
    // Should have dropped the oldest entry
    expect(content).not.toContain("Old entry 1");
    expect(content).toContain("Old entry 2");
    expect(content).toContain("Old entry 3");
    expect(content).toContain("New entry");
  });
});

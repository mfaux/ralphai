import { describe, it, expect } from "bun:test";
import { detectRunTarget } from "./target-detection.ts";
import type { RunTarget } from "./target-detection.ts";

// ---------------------------------------------------------------------------
// Auto-detection (undefined / no argument)
// ---------------------------------------------------------------------------

describe("detectRunTarget — auto", () => {
  it("returns auto when argument is undefined", () => {
    const result = detectRunTarget(undefined);
    expect(result).toEqual({ type: "auto" });
  });
});

// ---------------------------------------------------------------------------
// Issue number detection
// ---------------------------------------------------------------------------

describe("detectRunTarget — issue", () => {
  it('classifies "42" as issue 42', () => {
    const result = detectRunTarget("42");
    expect(result).toEqual({ type: "issue", number: 42 });
  });

  it('classifies "1" as issue 1', () => {
    const result = detectRunTarget("1");
    expect(result).toEqual({ type: "issue", number: 1 });
  });

  it('classifies "0" as issue 0', () => {
    // AC: detection layer does not validate against GitHub API
    const result = detectRunTarget("0");
    expect(result).toEqual({ type: "issue", number: 0 });
  });

  it("strips leading zeros — 007 becomes 7", () => {
    const result = detectRunTarget("007");
    expect(result).toEqual({ type: "issue", number: 7 });
  });

  it("strips leading zeros — 042 becomes 42", () => {
    const result = detectRunTarget("042");
    expect(result).toEqual({ type: "issue", number: 42 });
  });

  it("handles large issue numbers", () => {
    const result = detectRunTarget("99999");
    expect(result).toEqual({ type: "issue", number: 99999 });
  });
});

// ---------------------------------------------------------------------------
// Plan path detection
// ---------------------------------------------------------------------------

describe("detectRunTarget — plan", () => {
  it('classifies "my-feature.md" as a plan path', () => {
    const result = detectRunTarget("my-feature.md");
    expect(result).toEqual({ type: "plan", path: "my-feature.md" });
  });

  it('classifies "path/to/plan.md" as a plan path', () => {
    const result = detectRunTarget("path/to/plan.md");
    expect(result).toEqual({ type: "plan", path: "path/to/plan.md" });
  });

  it("classifies a Windows-style path with backslash as a plan path", () => {
    const result = detectRunTarget("backlog\\plan.md");
    expect(result).toEqual({ type: "plan", path: "backlog\\plan.md" });
  });

  it("classifies a path with forward slash but no .md extension as a plan", () => {
    // AC: path separator presence triggers plan detection
    const result = detectRunTarget("backlog/plan.txt");
    expect(result).toEqual({ type: "plan", path: "backlog/plan.txt" });
  });

  it("classifies a path with backslash but no .md extension as a plan", () => {
    const result = detectRunTarget("backlog\\plan.txt");
    expect(result).toEqual({ type: "plan", path: "backlog\\plan.txt" });
  });

  it("classifies a bare .md file with no directory as a plan", () => {
    const result = detectRunTarget("README.md");
    expect(result).toEqual({ type: "plan", path: "README.md" });
  });

  it("classifies a deeply nested plan path", () => {
    const result = detectRunTarget("a/b/c/d/feature.md");
    expect(result).toEqual({ type: "plan", path: "a/b/c/d/feature.md" });
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("detectRunTarget — errors", () => {
  it("throws for a bare string with no .md and no path separator", () => {
    expect(() => detectRunTarget("abc")).toThrow(/Invalid run target "abc"/);
  });

  it("throws for an empty string", () => {
    // AC: empty string is not equivalent to undefined
    expect(() => detectRunTarget("")).toThrow(/Invalid run target ""/);
  });

  it("throws for a negative number string", () => {
    // "-42" is not a valid issue number (contains a sign)
    expect(() => detectRunTarget("-42")).toThrow(/Invalid run target "-42"/);
  });

  it("throws for a floating-point number string", () => {
    expect(() => detectRunTarget("3.14")).toThrow(/Invalid run target "3.14"/);
  });

  it("throws for a string with spaces", () => {
    expect(() => detectRunTarget("not a target")).toThrow(
      /Invalid run target "not a target"/,
    );
  });

  it("throws for a bare word like a branch name", () => {
    expect(() => detectRunTarget("feature-branch")).toThrow(
      /Invalid run target "feature-branch"/,
    );
  });

  it("error message suggests valid target formats", () => {
    try {
      detectRunTarget("invalid");
      throw new Error("expected detectRunTarget to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("issue number");
      expect(message).toContain(".md");
      expect(message).toContain("auto-detection");
    }
  });
});

// ---------------------------------------------------------------------------
// Type discrimination (compile-time check via runtime narrowing)
// ---------------------------------------------------------------------------

describe("RunTarget type narrowing", () => {
  it("narrows issue target to access .number", () => {
    const target: RunTarget = detectRunTarget("42");
    if (target.type === "issue") {
      // This would fail at compile time if the discriminated union is wrong
      expect(target.number).toBe(42);
    } else {
      throw new Error("expected issue target");
    }
  });

  it("narrows plan target to access .path", () => {
    const target: RunTarget = detectRunTarget("feature.md");
    if (target.type === "plan") {
      expect(target.path).toBe("feature.md");
    } else {
      throw new Error("expected plan target");
    }
  });

  it("narrows auto target — no extra properties", () => {
    const target: RunTarget = detectRunTarget(undefined);
    expect(target.type).toBe("auto");
    // auto has only the type field
    expect(Object.keys(target)).toEqual(["type"]);
  });
});

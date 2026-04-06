import { describe, it, expect } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  extractScope,
  extractDependsOn,
  extractIssueFrontmatter,
  extractFeedbackScope,
  parseFrontmatter,
} from "./frontmatter.ts";
import { useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// extractDependsOn() unit tests
// ---------------------------------------------------------------------------

describe("extractDependsOn", () => {
  const ctx = useTempDir();

  it("returns inline array deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md, b.md]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("returns single inline dep", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [setup.md]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["setup.md"]);
  });

  it("returns multiline YAML list deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - plan-a.md\n  - plan-b.md\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["plan-a.md", "plan-b.md"]);
  });

  it("returns single multiline dep", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on:\n  - only-one.md\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["only-one.md"]);
  });

  it("stops multiline collection at next key", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - dep-a.md\nscope: packages/web\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["dep-a.md"]);
  });

  it("returns empty array when no depends-on", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual([]);
  });

  it("returns empty array for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    expect(extractDependsOn(p)).toEqual([]);
  });

  it("returns empty array for nonexistent file", () => {
    expect(extractDependsOn(join(ctx.dir, "nope.md"))).toEqual([]);
  });

  it("strips quotes from inline deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [\"a.md\", 'b.md']\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("strips quotes from multiline deps", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - \"quoted.md\"\n  - 'single.md'\n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["quoted.md", "single.md"]);
  });

  it("handles trailing whitespace on inline values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\ndepends-on: [a.md , b.md ]\n---\n\n# Plan\n");
    expect(extractDependsOn(p)).toEqual(["a.md", "b.md"]);
  });

  it("handles trailing whitespace on multiline values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\ndepends-on:\n  - dep-a.md   \n  - dep-b.md  \n---\n\n# Plan\n",
    );
    expect(extractDependsOn(p)).toEqual(["dep-a.md", "dep-b.md"]);
  });
});

// ---------------------------------------------------------------------------
// extractIssueFrontmatter() unit tests
// ---------------------------------------------------------------------------

describe("extractIssueFrontmatter", () => {
  const ctx = useTempDir();

  it("extracts all issue fields", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github\nissue: 42\nissue-url: https://github.com/org/repo/issues/42\n---\n\n# Fix bug\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("github");
    expect(result.issue).toBe(42);
    expect(result.issueUrl).toBe("https://github.com/org/repo/issues/42");
  });

  it("returns defaults when no issue fields", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("returns defaults for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("returns defaults for nonexistent file", () => {
    const result = extractIssueFrontmatter(join(ctx.dir, "nope.md"));
    expect(result.source).toBe("");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("handles partial issue fields (source only)", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nsource: manual\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("manual");
    expect(result.issue).toBeUndefined();
    expect(result.issueUrl).toBe("");
  });

  it("handles trailing whitespace on values", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github   \nissue: 7   \nissue-url: https://example.com   \n---\n\n# Plan\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.source).toBe("github");
    expect(result.issue).toBe(7);
    expect(result.issueUrl).toBe("https://example.com");
  });

  it("extracts prd field when present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      "---\nsource: github\nissue: 42\nprd: 30\n---\n\n# Fix bug\n",
    );
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBe(30);
    expect(result.issue).toBe(42);
  });

  it("returns undefined prd when not present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nsource: github\nissue: 42\n---\n\n# Fix bug\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBeUndefined();
  });

  it("returns undefined prd for non-numeric value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nprd: not-a-number\n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBeUndefined();
  });

  it("handles prd with trailing whitespace", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nprd: 15   \n---\n\n# Plan\n");
    const result = extractIssueFrontmatter(p);
    expect(result.prd).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// extractFeedbackScope() unit tests
// ---------------------------------------------------------------------------

describe("extractFeedbackScope", () => {
  const ctx = useTempDir();

  it("extracts feedback-scope value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nfeedback-scope: src/components\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("src/components");
  });

  it("returns empty string when feedback-scope is absent", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("");
  });

  it("returns empty string for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Plan: No Frontmatter\n");
    expect(extractFeedbackScope(p)).toBe("");
  });

  it("returns empty string for nonexistent file", () => {
    expect(extractFeedbackScope(join(ctx.dir, "nope.md"))).toBe("");
  });

  it("handles trailing whitespace on value", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nfeedback-scope: src/utils   \n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("src/utils");
  });

  it("returns empty string for empty frontmatter block", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\n---\n\n# Plan\n");
    expect(extractFeedbackScope(p)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter() unit tests
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  const ctx = useTempDir();

  it("parses all fields from a complete plan", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      [
        "---",
        "source: github",
        "issue: 99",
        "issue-url: https://github.com/org/repo/issues/99",
        "scope: packages/api",
        "feedback-scope: src/components",
        "depends-on: [setup.md, infra.md]",
        "prd: 50",
        "---",
        "",
        "# Full plan",
        "",
      ].join("\n"),
    );
    const fm = parseFrontmatter(p);
    expect(fm.source).toBe("github");
    expect(fm.issue).toBe(99);
    expect(fm.issueUrl).toBe("https://github.com/org/repo/issues/99");
    expect(fm.scope).toBe("packages/api");
    expect(fm.feedbackScope).toBe("src/components");
    expect(fm.dependsOn).toEqual(["setup.md", "infra.md"]);
    expect(fm.prd).toBe(50);
  });

  it("parses with multiline depends-on", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(
      p,
      [
        "---",
        "scope: lib",
        "depends-on:",
        "  - alpha.md",
        "  - beta.md",
        "---",
        "",
        "# Multiline plan",
        "",
      ].join("\n"),
    );
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("lib");
    expect(fm.dependsOn).toEqual(["alpha.md", "beta.md"]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
  });

  it("returns defaults for no frontmatter", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "# Just a heading\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("returns defaults for nonexistent file", () => {
    const fm = parseFrontmatter(join(ctx.dir, "nope.md"));
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("returns defaults for empty frontmatter block", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\n---\n\n# Plan\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("");
    expect(fm.feedbackScope).toBe("");
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issue).toBeUndefined();
    expect(fm.issueUrl).toBe("");
    expect(fm.prd).toBeUndefined();
  });

  it("handles mixed fields with only some present", () => {
    const p = join(ctx.dir, "plan.md");
    writeFileSync(p, "---\nscope: packages/web\nissue: 12\n---\n\n# Partial\n");
    const fm = parseFrontmatter(p);
    expect(fm.scope).toBe("packages/web");
    expect(fm.issue).toBe(12);
    expect(fm.dependsOn).toEqual([]);
    expect(fm.source).toBe("");
    expect(fm.issueUrl).toBe("");
  });
});

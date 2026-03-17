import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { extractScope } from "./frontmatter.ts";
import { useTempGitDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// extractScope() unit tests
// ---------------------------------------------------------------------------

describe("extractScope", () => {
  const ctx = useTempGitDir();

  it("returns scope value from frontmatter", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(planPath, "---\nscope: packages/web\n---\n\n# Plan: Test\n");
    expect(extractScope(planPath)).toBe("packages/web");
  });

  it("returns scope with nested path", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(planPath, "---\nscope: apps/api\n---\n\n# Plan: API\n");
    expect(extractScope(planPath)).toBe("apps/api");
  });

  it("returns empty string when no scope", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(planPath, "---\nsource: github\n---\n\n# Plan: No Scope\n");
    expect(extractScope(planPath)).toBe("");
  });

  it("returns empty string when no frontmatter", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(planPath, "# Plan: No Frontmatter\n");
    expect(extractScope(planPath)).toBe("");
  });

  it("returns empty string for nonexistent file", () => {
    expect(extractScope(join(ctx.dir, "nonexistent.md"))).toBe("");
  });

  it("works alongside depends-on and source fields", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(
      planPath,
      "---\nsource: github\nscope: packages/shared\ndepends-on: [setup.md]\n---\n\n# Plan: Multi\n",
    );
    expect(extractScope(planPath)).toBe("packages/shared");
  });

  it("trims trailing whitespace from scope value", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(
      planPath,
      "---\nscope: packages/web   \n---\n\n# Plan: Whitespace\n",
    );
    expect(extractScope(planPath)).toBe("packages/web");
  });

  it("handles scope as the only frontmatter field", () => {
    const planPath = join(ctx.dir, "plan.md");
    writeFileSync(planPath, "---\nscope: lib\n---\n\n# Plan: Lib Only\n");
    expect(extractScope(planPath)).toBe("lib");
  });
});

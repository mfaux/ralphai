import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { extractScope } from "./frontmatter.ts";
import { resolveScope } from "./scope.ts";
import { useTempDir, useTempGitDir } from "./test-utils.ts";

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

// ---------------------------------------------------------------------------
// resolveScope() unit tests
// ---------------------------------------------------------------------------

describe("resolveScope", () => {
  const ctx = useTempDir();

  it("passes through feedback commands when no scope is set", () => {
    // Create a pnpm project so ecosystem detection works
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "",
      rootFeedbackCommands: "pnpm test,pnpm run build",
      rootPrFeedbackCommands: "",
    });

    expect(result.feedbackCommands).toBe("pnpm test,pnpm run build");
    expect(result.prFeedbackCommands).toBe("");
    expect(result.ecosystem).toBe("node");
    expect(result.scopeHint).toBe("");
  });

  it("rewrites pnpm commands for a scoped node package", () => {
    // Root: pnpm monorepo
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    // Scoped package
    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "pnpm test,pnpm run build",
      rootPrFeedbackCommands: "",
    });

    expect(result.ecosystem).toBe("node");
    expect(result.packageManager).toBe("pnpm");
    expect(result.feedbackCommands).toBe(
      "pnpm --filter @repo/web test,pnpm --filter @repo/web build",
    );
    expect(result.scopeHint).toContain("packages/web");
  });

  it("rewrites yarn commands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "root",
        scripts: { test: "jest" },
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(join(ctx.dir, "yarn.lock"), "# yarn lockfile v1\n");

    const pkgDir = join(ctx.dir, "packages", "lib");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/lib" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/lib",
      rootFeedbackCommands: "yarn test,yarn build",
      rootPrFeedbackCommands: "",
    });

    expect(result.packageManager).toBe("yarn");
    expect(result.feedbackCommands).toBe(
      "yarn workspace @repo/lib test,yarn workspace @repo/lib build",
    );
  });

  it("rewrites npm commands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "jest" } }),
    );
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");

    const pkgDir = join(ctx.dir, "packages", "api");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/api" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/api",
      rootFeedbackCommands: "npm run test,npm run build",
      rootPrFeedbackCommands: "",
    });

    expect(result.packageManager).toBe("npm");
    expect(result.feedbackCommands).toBe(
      "npm -w @repo/api run test,npm -w @repo/api run build",
    );
  });

  it("rewrites dotnet commands by appending project path", () => {
    writeFileSync(join(ctx.dir, "MySolution.sln"), "");
    const projDir = join(ctx.dir, "src", "MyProject");
    mkdirSync(projDir, { recursive: true });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "src/MyProject",
      rootFeedbackCommands: "dotnet build,dotnet test",
      rootPrFeedbackCommands: "",
    });

    expect(result.ecosystem).toBe("dotnet");
    expect(result.feedbackCommands).toBe(
      "dotnet build src/MyProject,dotnet test src/MyProject",
    );
  });

  it("passes non-PM commands through unchanged", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "make test,pnpm build",
      rootPrFeedbackCommands: "",
    });

    // "make test" passes through unchanged, "pnpm build" is rewritten
    expect(result.feedbackCommands).toBe(
      "make test,pnpm --filter @repo/web build",
    );
  });

  it("passes through unchanged for unsupported ecosystems", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "cmd/server",
      rootFeedbackCommands: "go build ./...,go test ./...",
      rootPrFeedbackCommands: "",
    });

    expect(result.ecosystem).toBe("go");
    expect(result.feedbackCommands).toBe("go build ./...,go test ./...");
    expect(result.scopeHint).toContain("cmd/server");
  });

  it("returns unknown ecosystem when nothing is detected", () => {
    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "some/path",
      rootFeedbackCommands: "make test",
      rootPrFeedbackCommands: "",
    });

    expect(result.ecosystem).toBe("unknown");
    expect(result.feedbackCommands).toBe("make test");
    expect(result.scopeHint).toContain("some/path");
  });

  it("uses workspace config override when provided", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/special": {
        feedbackCommands: ["custom build", "custom test"],
      },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/special",
      rootFeedbackCommands: "pnpm test,pnpm build",
      rootPrFeedbackCommands: "",
      workspacesConfig: wsConfig,
    });

    expect(result.feedbackCommands).toBe("custom build,custom test");
  });

  it("falls through when workspace config has no matching scope", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const wsConfig = JSON.stringify({
      "packages/other": { feedbackCommands: ["custom test"] },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "",
      workspacesConfig: wsConfig,
    });

    // Should fall through to auto-detection, not use the "other" override
    expect(result.feedbackCommands).toBe("pnpm --filter @repo/web test");
  });

  it("handles mixed node + dotnet repo scoping", () => {
    // Root: node project with dotnet feedback merged in
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "pnpm test,dotnet build",
      rootPrFeedbackCommands: "",
    });

    // pnpm command is rewritten, dotnet command gets scope appended
    expect(result.feedbackCommands).toBe(
      "pnpm --filter @repo/web test,dotnet build packages/web",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveScope() prFeedbackCommands tests
// ---------------------------------------------------------------------------

describe("resolveScope prFeedbackCommands", () => {
  const ctx = useTempDir();

  it("rewrites pnpm prFeedbackCommands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@app/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "pnpm test:e2e",
    });

    expect(result.prFeedbackCommands).toBe("pnpm --filter @app/web test:e2e");
  });

  it("rewrites yarn prFeedbackCommands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "root",
        scripts: { test: "jest" },
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(join(ctx.dir, "yarn.lock"), "# yarn lockfile v1\n");

    const pkgDir = join(ctx.dir, "packages", "lib");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/lib" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/lib",
      rootFeedbackCommands: "yarn test",
      rootPrFeedbackCommands: "yarn test:e2e",
    });

    expect(result.prFeedbackCommands).toBe("yarn workspace @repo/lib test:e2e");
  });

  it("rewrites npm prFeedbackCommands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "jest" } }),
    );
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");

    const pkgDir = join(ctx.dir, "packages", "api");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/api" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/api",
      rootFeedbackCommands: "npm run test",
      rootPrFeedbackCommands: "npm run test:e2e",
    });

    expect(result.prFeedbackCommands).toBe("npm -w @repo/api run test:e2e");
  });

  it("rewrites bun prFeedbackCommands for a scoped node package", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "bun.lock"), "{}");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "bun run test",
      rootPrFeedbackCommands: "bun run test:e2e",
    });

    expect(result.prFeedbackCommands).toBe(
      "bun --filter @repo/web run test:e2e",
    );
  });

  it("rewrites dotnet prFeedbackCommands by appending project path", () => {
    writeFileSync(join(ctx.dir, "MySolution.sln"), "");
    const projDir = join(ctx.dir, "src", "MyProject");
    mkdirSync(projDir, { recursive: true });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "src/MyProject",
      rootFeedbackCommands: "dotnet build",
      rootPrFeedbackCommands: "dotnet test",
    });

    expect(result.prFeedbackCommands).toBe("dotnet test src/MyProject");
  });

  it("uses workspace prFeedbackCommands override when present", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/special": {
        feedbackCommands: ["custom build"],
        prFeedbackCommands: ["custom e2e"],
      },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/special",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "pnpm test:e2e",
      workspacesConfig: wsConfig,
    });

    expect(result.prFeedbackCommands).toBe("custom e2e");
  });

  it("falls through to root prFeedbackCommands when workspace override has no prFeedbackCommands", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/special": {
        feedbackCommands: ["custom build"],
      },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/special",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "pnpm test:e2e",
      workspacesConfig: wsConfig,
    });

    // Workspace override has feedbackCommands but no prFeedbackCommands,
    // so prFeedbackCommands falls through to the root value.
    expect(result.prFeedbackCommands).toBe("pnpm test:e2e");
  });

  it("passes through prFeedbackCommands unchanged when no scope", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "pnpm test:e2e",
    });

    expect(result.prFeedbackCommands).toBe("pnpm test:e2e");
  });

  it("passes through prFeedbackCommands unchanged for unsupported ecosystems", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "cmd/server",
      rootFeedbackCommands: "go test ./...",
      rootPrFeedbackCommands: "go test -race ./...",
    });

    expect(result.prFeedbackCommands).toBe("go test -race ./...");
  });

  it("returns empty string when prFeedbackCommands is empty", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "pnpm test",
      rootPrFeedbackCommands: "",
    });

    expect(result.prFeedbackCommands).toBe("");
  });

  it("rewrites prFeedbackCommands even when rootFeedbackCommands is empty", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", scripts: { test: "vitest" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const pkgDir = join(ctx.dir, "packages", "web");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/web" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "",
      rootPrFeedbackCommands: "pnpm test:e2e",
    });

    expect(result.feedbackCommands).toBe("");
    expect(result.prFeedbackCommands).toBe("pnpm --filter @repo/web test:e2e");
  });
});

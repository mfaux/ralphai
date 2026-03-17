import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// Workspace detection via init --yes
// ---------------------------------------------------------------------------

describe("workspace detection in init", () => {
  const ctx = useTempGitDir();

  it("detects pnpm monorepo workspaces", () => {
    // Create pnpm-workspace.yaml
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    // Create two workspace packages
    const webDir = join(ctx.dir, "packages", "web");
    const apiDir = join(ctx.dir, "packages", "api");
    mkdirSync(webDir, { recursive: true });
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(
      join(webDir, "package.json"),
      JSON.stringify({ name: "@org/web" }),
    );
    writeFileSync(
      join(apiDir, "package.json"),
      JSON.stringify({ name: "@org/api" }),
    );

    // Root package.json with scripts
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        scripts: { build: "echo build", test: "echo test" },
      }),
    );

    const output = stripLogo(
      runCli(["init", "--yes"], ctx.dir).stdout +
        runCli(["init", "--yes"], ctx.dir).stderr,
    );

    // Re-run cleanly (first run creates .ralphai)
    // Use a fresh approach: init, then check output
    const result = runCli(["init", "--yes", "--force"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("2 packages");
    expect(combined).toContain("@org/web");
    expect(combined).toContain("@org/api");
  });

  it("detects npm/yarn workspaces from package.json", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        workspaces: ["packages/*"],
        scripts: { build: "echo build" },
      }),
    );
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");

    const pkgDir = join(ctx.dir, "packages", "shared");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@org/shared" }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("1 packages");
    expect(combined).toContain("@org/shared");
  });

  it("shows no workspace info for single-project repos", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "single-project",
        scripts: { build: "echo build" },
      }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).not.toContain("Workspaces");
    expect(combined).not.toContain("packages");
  });

  it("shows no workspace info when globs match nothing", () => {
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    // packages/ dir exists but is empty
    mkdirSync(join(ctx.dir, "packages"), { recursive: true });

    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "empty-monorepo" }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).not.toContain("Workspaces");
  });

  it("--yes mode does not add workspaces to config", () => {
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const webDir = join(ctx.dir, "packages", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      join(webDir, "package.json"),
      JSON.stringify({ name: "@org/web" }),
    );

    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        scripts: { build: "echo build" },
      }),
    );

    runCli(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    expect(config.workspaces).toBeUndefined();
  });

  it("--yes mode prints auto-filter hint for monorepos", () => {
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const webDir = join(ctx.dir, "packages", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(
      join(webDir, "package.json"),
      JSON.stringify({ name: "@org/web" }),
    );

    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        scripts: { build: "echo build" },
      }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("auto-filtered by scope");
  });
});

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml parsing edge cases
// ---------------------------------------------------------------------------

describe("pnpm-workspace.yaml parsing", () => {
  const ctx = useTempGitDir();

  it("handles quoted globs in pnpm-workspace.yaml", () => {
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const appDir = join(ctx.dir, "apps", "frontend");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "package.json"),
      JSON.stringify({ name: "frontend" }),
    );

    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "monorepo" }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("1 packages");
    expect(combined).toContain("frontend");
  });

  it("handles multiple glob patterns", () => {
    writeFileSync(
      join(ctx.dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const webDir = join(ctx.dir, "packages", "web");
    const appDir = join(ctx.dir, "apps", "dashboard");
    mkdirSync(webDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(webDir, "package.json"),
      JSON.stringify({ name: "@org/web" }),
    );
    writeFileSync(
      join(appDir, "package.json"),
      JSON.stringify({ name: "@org/dashboard" }),
    );

    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "monorepo" }),
    );

    const result = runCli(["init", "--yes"], ctx.dir);
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("2 packages");
    expect(combined).toContain("@org/web");
    expect(combined).toContain("@org/dashboard");
  });
});

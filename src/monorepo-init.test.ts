import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { runCliInProcess, stripLogo, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";

// ---------------------------------------------------------------------------
// Workspace detection via init --yes
// ---------------------------------------------------------------------------

describe("workspace detection in init", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("detects pnpm monorepo workspaces", async () => {
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
      (await runCliInProcess(["init", "--yes"], ctx.dir, testEnv())).stdout +
        (await runCliInProcess(["init", "--yes"], ctx.dir, testEnv())).stderr,
    );

    // Re-run cleanly (first run creates .ralphai)
    // Use a fresh approach: init, then check output
    const result = await runCliInProcess(
      ["init", "--yes", "--force"],
      ctx.dir,
      testEnv(),
    );
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("2 packages");
    expect(combined).toContain("@org/web");
    expect(combined).toContain("@org/api");
  });

  it("detects npm/yarn workspaces from package.json", async () => {
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

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("1 packages");
    expect(combined).toContain("@org/shared");
  });

  it("shows no workspace info for single-project repos", async () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "single-project",
        scripts: { build: "echo build" },
      }),
    );

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).not.toContain("Workspaces");
    expect(combined).not.toContain("packages");
  });

  it("shows no workspace info when globs match nothing", async () => {
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

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).not.toContain("Workspaces");
  });

  it("--yes mode does not add workspaces to config", async () => {
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

    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.workspaces).toBeUndefined();
  });

  it("--yes mode prints auto-filter hint for monorepos", async () => {
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

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("auto-filtered by scope");
  });
});

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml parsing edge cases
// ---------------------------------------------------------------------------

describe("pnpm-workspace.yaml parsing", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("handles quoted globs in pnpm-workspace.yaml", async () => {
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

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("1 packages");
    expect(combined).toContain("frontend");
  });

  it("handles multiple glob patterns", async () => {
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

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("2 packages");
    expect(combined).toContain("@org/web");
    expect(combined).toContain("@org/dashboard");
  });
});

// ---------------------------------------------------------------------------
// Workspace display truncation
// ---------------------------------------------------------------------------

describe("workspace display truncation", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("truncates workspace names when more than 10 are detected", async () => {
    // Create a .sln file with 15 projects to trigger truncation
    const projectLines: string[] = [];
    for (let i = 1; i <= 15; i++) {
      projectLines.push(
        `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Project${i}", "src\\Project${i}\\Project${i}.csproj", "{00000000-0000-0000-0000-00000000000${String(i).padStart(1, "0")}}"`,
      );
    }
    writeFileSync(join(ctx.dir, "App.sln"), projectLines.join("\n") + "\n");

    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;

    expect(combined).toContain("15 packages");
    // First 10 should be visible
    expect(combined).toContain("Project1");
    expect(combined).toContain("Project10");
    // Should show truncation indicator
    expect(combined).toContain("... and 5 more");
    // Project11-15 should NOT be in the name list
    expect(combined).not.toMatch(/Project11[^5]/);
  });
});

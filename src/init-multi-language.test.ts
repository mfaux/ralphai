import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { runCliInProcess, stripLogo, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";

describe("init multi-language detection", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("init --yes in a dotnet solution directory detects dotnet", async () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toContain("Detected:");
    expect(output).toMatch(/Project:.*dotnet \(solution\)/);
  });

  it("init --yes in a dotnet directory sets feedback to dotnet build, dotnet test", async () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.feedbackCommands).toEqual(["dotnet build", "dotnet test"]);
  });

  it("init --yes in a Go module directory detects go", async () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/myapp\n");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toMatch(/Project:.*go module/);
  });

  it("init --yes in a Go directory sets feedback to go build and go test", async () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/myapp\n");
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.feedbackCommands).toEqual([
      "go build ./...",
      "go test ./...",
    ]);
  });

  it("init --yes in a Rust project directory detects cargo", async () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), "[package]\nname = 'myapp'\n");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toMatch(/Project:.*cargo/);
  });

  it("init --yes in a Maven project directory detects maven", async () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toMatch(/Project:.*maven/);
  });

  it("init --yes in a Python project directory detects python", async () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      "[tool.pytest]\ntestpaths = ['tests']\n",
    );
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).toMatch(/Project:.*python \(pyproject\)/);
  });

  it("init --yes in a Python project with pytest sets feedback", async () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      "[tool.pytest]\ntestpaths = ['tests']\n",
    );
    await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.feedbackCommands).toEqual(["python -m pytest"]);
  });

  it("init --yes does not warn about missing feedback for non-JS projects with feedback", async () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    // Dotnet auto-detects "dotnet build, dotnet test", so no warning
    expect(output).not.toContain("No build/test/lint scripts detected");
  });

  it("init --yes with both package.json and .sln prefers node detection", async () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    // Node should win over dotnet
    expect(output).toMatch(/Project:.*pnpm/);
  });

  it("init --yes with bare package.json and .sln detects dotnet as primary", async () => {
    // Stub package.json with no scripts, no lock file, no workspaces
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ dependencies: {} }),
    );
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const result = await runCliInProcess(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    // Dotnet should win because package.json lacks substance
    expect(output).toMatch(/Project:.*dotnet/);
  });
});

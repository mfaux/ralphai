import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

describe("init multi-language detection", () => {
  const ctx = useTempGitDir();

  it("init --yes in a dotnet solution directory detects dotnet", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("Detected:");
    expect(output).toMatch(/Project:.*dotnet \(solution\)/);
  });

  it("init --yes in a dotnet directory sets feedback to dotnet build, dotnet test", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    expect(config.feedbackCommands).toEqual(["dotnet build", "dotnet test"]);
  });

  it("init --yes in a Go module directory detects go", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/myapp\n");
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toMatch(/Project:.*go module/);
  });

  it("init --yes in a Go directory sets feedback to go build and go test", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/myapp\n");
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    expect(config.feedbackCommands).toEqual([
      "go build ./...",
      "go test ./...",
    ]);
  });

  it("init --yes in a Rust project directory detects cargo", () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), "[package]\nname = 'myapp'\n");
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toMatch(/Project:.*cargo/);
  });

  it("init --yes in a Maven project directory detects maven", () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>");
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toMatch(/Project:.*maven/);
  });

  it("init --yes in a Python project directory detects python", () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      "[tool.pytest]\ntestpaths = ['tests']\n",
    );
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toMatch(/Project:.*python \(pyproject\)/);
  });

  it("init --yes in a Python project with pytest sets feedback", () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      "[tool.pytest]\ntestpaths = ['tests']\n",
    );
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    expect(config.feedbackCommands).toEqual(["python -m pytest"]);
  });

  it("init --yes does not warn about missing feedback for non-JS projects with feedback", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const result = runCli(["init", "--yes"], ctx.dir);
    const output = result.stdout + result.stderr;

    // Dotnet auto-detects "dotnet build, dotnet test", so no warning
    expect(output).not.toContain("No build/test/lint scripts detected");
  });

  it("init --yes with both package.json and .sln prefers node detection", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    // Node should win over dotnet
    expect(output).toMatch(/Project:.*pnpm/);
  });
});

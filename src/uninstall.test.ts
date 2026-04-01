import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs, resolveRepoStateDir } from "./global-state.ts";

describe("uninstall command (repo-scoped default)", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("uninstall --yes removes only this repo's state directory", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());
    const configPath = getConfigFilePath(ctx.dir, testEnv());
    expect(existsSync(configPath)).toBe(true);

    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Ralphai torn down");
    const stateDir = resolveRepoStateDir(ctx.dir, testEnv());
    expect(existsSync(configPath)).toBe(false);
    // The global home directory should still exist
    const ralphaiHome = join(ctx.dir, ".ralphai-home");
    expect(existsSync(ralphaiHome)).toBe(true);
  });

  it("uninstall --yes prints not set up when config does not exist", () => {
    const output = stripLogo(
      runCliOutput(["uninstall", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("not set up");
    expect(output).toContain("no config found");
  });

  it("uninstall -y works as alias for --yes", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());
    const configPath = getConfigFilePath(ctx.dir, testEnv());
    expect(existsSync(configPath)).toBe(true);

    const output = stripLogo(
      runCliOutput(["uninstall", "-y"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Ralphai torn down");
    expect(existsSync(configPath)).toBe(false);
  });

  it("uninstall --yes <target-dir> uninstalls from target directory", () => {
    const targetDir = join(
      tmpdir(),
      `ralphai-uninstall-target-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(targetDir, { recursive: true });
    execSync("git init", { cwd: targetDir, stdio: "ignore" });

    try {
      runCliOutput(["init", "--yes", targetDir], ctx.dir, testEnv());
      const configPath = getConfigFilePath(targetDir, testEnv());
      expect(existsSync(configPath)).toBe(true);

      const output = stripLogo(
        runCliOutput(["uninstall", "--yes", targetDir], ctx.dir, testEnv()),
      );

      expect(output).toContain("Ralphai torn down");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  });
});

describe("uninstall --global command", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("uninstall --global --yes removes the global state directory", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());
    const ralphaiHome = join(ctx.dir, ".ralphai-home");
    expect(existsSync(ralphaiHome)).toBe(true);

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Removed");
    expect(output).toContain(ralphaiHome);
    expect(existsSync(ralphaiHome)).toBe(false);
  });

  it("uninstall --global --yes prints package manager uninstall command", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toMatch(
      /npm uninstall -g ralphai|pnpm remove -g ralphai|yarn global remove ralphai|bun remove -g ralphai/,
    );
  });

  it("uninstall --global --yes handles missing global state directory", () => {
    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("No global state directory found");
    expect(output).toMatch(
      /npm uninstall -g ralphai|pnpm remove -g ralphai|yarn global remove ralphai|bun remove -g ralphai/,
    );
  });

  it("uninstall --global --yes warns about plans in the backlog", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    writeFileSync(join(backlogDir, "prd-feature-x.md"), "# Feature X");

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("2 in backlog");
  });

  it("uninstall --global --yes warns about plans in progress", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(wipDir, "prd-feature-y");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-feature-y.md"), "# Feature Y");

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("1 in progress");
  });

  it("uninstall --global --yes warns about backlog and in-progress plans together", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { backlogDir, wipDir } = getRepoPipelineDirs(ctx.dir, testEnv());

    writeFileSync(join(backlogDir, "prd-a.md"), "# A");
    writeFileSync(join(backlogDir, "prd-b.md"), "# B");

    const planDir = join(wipDir, "prd-c");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "prd-c.md"), "# C");

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).toContain("Warning: active plans found");
    expect(output).toContain("3 in backlog");
    expect(output).toContain("1 in progress");
  });

  it("uninstall --global --yes does not warn when no plans exist", () => {
    runCliOutput(["init", "--yes"], ctx.dir, testEnv());

    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const samplePlan = join(backlogDir, "hello-world.md");
    if (existsSync(samplePlan)) rmSync(samplePlan, { force: true });

    const output = stripLogo(
      runCliOutput(["uninstall", "--global", "--yes"], ctx.dir, testEnv()),
    );

    expect(output).not.toContain("Warning");
  });
});

describe("uninstall help and flags", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("uninstall --help shows usage, --global, and --yes flags", () => {
    const result = runCli(["uninstall", "--help"], ctx.dir, testEnv());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("--global");
    expect(result.stdout).toContain("--yes");
  });

  it("uninstall rejects unknown flags", () => {
    const result = runCli(["uninstall", "--bogus"], ctx.dir, testEnv());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown flag");
  });
});

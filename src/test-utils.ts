import { execFileSync, execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { beforeEach, afterEach } from "vitest";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function stripLogo(str: string): string {
  // ralphai has no fancy logo, but strip any leading blank lines
  return str.replace(/^\n+/, "");
}

export function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
  timeout?: number,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const output = execFileSync(
      "node",
      ["--experimental-strip-types", CLI_PATH, ...args],
      {
        encoding: "utf-8",
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: env ? { ...process.env, ...env } : undefined,
        timeout: timeout ?? 30000,
      },
    );
    return { stdout: stripAnsi(output), stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: stripAnsi(error.stdout || ""),
      stderr: stripAnsi(error.stderr || ""),
      exitCode: error.status || 1,
    };
  }
}

export function runCliOutput(args: string[], cwd?: string): string {
  const result = runCli(args, cwd);
  return result.stdout || result.stderr;
}

/**
 * Creates a temporary git-initialized directory for each test.
 * Returns an object with a `dir` getter that always points to the current test's directory.
 *
 * Usage:
 *   const ctx = useTempGitDir();
 *   it("does something", () => { runCli(["init", "--yes"], ctx.dir); });
 */
export function useTempGitDir() {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ralphai-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // Initialize a git repo so detectBaseBranch() works
    execSync("git init", { cwd: testDir, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  return {
    get dir() {
      return testDir;
    },
  };
}

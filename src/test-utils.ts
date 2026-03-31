import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { beforeEach, afterEach } from "bun:test";

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cleanupTempDir(testDir: string): void {
  const isWindows = process.platform === "win32";
  const maxAttempts = isWindows ? 12 : 1;
  let dirToRemove = testDir;

  if (isWindows && existsSync(testDir)) {
    const renamedDir = `${testDir}-cleanup-${process.pid}-${Date.now()}`;
    try {
      renameSync(testDir, renamedDir);
      dirToRemove = renamedDir;
    } catch {
      dirToRemove = testDir;
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!existsSync(dirToRemove)) {
      return;
    }

    try {
      rmSync(dirToRemove, {
        recursive: true,
        force: true,
        maxRetries: isWindows ? 10 : 5,
      });
      return;
    } catch (error) {
      if (!isWindows || attempt === maxAttempts) {
        // On Windows, swallow EPERM/EBUSY errors from locked files (git
        // processes or node child processes may still hold handles). The
        // OS temp directory will be cleaned up eventually.
        if (
          isWindows &&
          error instanceof Error &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EBUSY")
        ) {
          return;
        }
        throw error;
      }
      sleepMs(100 * attempt);
    }
  }
}

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

export function runCliOutput(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): string {
  const result = runCli(args, cwd, env);
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
/**
 * Creates a temporary directory for each test (no git init).
 * Useful for unit tests that only need a filesystem sandbox.
 */
export function useTempDir() {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "ralphai-test-"));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      cleanupTempDir(testDir);
    }
  });

  return {
    get dir() {
      return testDir;
    },
  };
}

export function useTempGitDir() {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "ralphai-test-"));
    // Initialize a git repo so detectBaseBranch() works
    execSync("git init", { cwd: testDir, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      cleanupTempDir(testDir);
    }
  });

  return {
    get dir() {
      return testDir;
    },
  };
}

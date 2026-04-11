import { execFileSync, execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { beforeEach, afterEach } from "bun:test";
import { stripAnsi } from "./utils.ts";
import { runRalphai } from "./ralphai.ts";
import { ExitIntercepted } from "./interactive/maintenance-actions.ts";
import {
  DEFAULTS,
  type ConfigSource,
  type ConfigValues,
  type RalphaiConfig,
  type ResolvedConfig,
} from "./config.ts";

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

/**
 * Run a CLI command in-process by calling `runRalphai(args)` directly,
 * eliminating the ~300ms overhead of spawning a child Node process.
 *
 * Intercepts `process.exit`, `console.log`, `console.error`, and
 * `process.cwd()` (via `process.chdir`) to capture output and exit codes.
 * All monkey-patched globals are restored in a finally block.
 *
 * Has the same return type as `runCli()` so callers can be migrated with
 * a mechanical find-replace.
 *
 * Use `runCli()` instead when you need real subprocess behavior (E2E tests,
 * process-kill tests, NO_COLOR env var tests, or tests that rely on
 * module-level side effects from a fresh process).
 */
export async function runCliInProcess(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
  _timeout?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const originalCwd = process.cwd();

  // Save original env values so we can restore them
  const savedEnv: Record<string, string | undefined> = {};
  if (env) {
    for (const key of Object.keys(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = env[key];
    }
  }

  let exitCode = 0;
  let capturedExitCode: number | undefined;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  try {
    // Intercept process.exit to capture exit code
    process.exit = ((code?: number) => {
      capturedExitCode = code ?? 0;
      throw new ExitIntercepted();
    }) as never;

    // Capture console.log -> stdout
    console.log = (...logArgs: unknown[]) => {
      stdoutChunks.push(
        logArgs.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
    };

    // Capture console.error -> stderr
    console.error = (...errArgs: unknown[]) => {
      stderrChunks.push(
        errArgs.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
    };

    // Override cwd if requested
    if (cwd) {
      process.chdir(cwd);
    }

    await runRalphai(args);
  } catch (e) {
    if (e instanceof ExitIntercepted) {
      exitCode = capturedExitCode ?? 1;
    } else {
      // Unhandled error — treat as exit code 1
      exitCode = 1;
    }
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    process.chdir(originalCwd);

    // Restore original env values
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  }

  return {
    stdout: stripAnsi(stdoutChunks.join("\n")),
    stderr: stripAnsi(stderrChunks.join("\n")),
    exitCode,
  };
}

/**
 * Convenience wrapper around `runCliInProcess()` that returns `stdout || stderr`,
 * mirroring the `runCliOutput()` helper.
 */
export async function runCliOutputInProcess(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<string> {
  const result = await runCliInProcess(args, cwd, env);
  return result.stdout || result.stderr;
}

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

/** Initialize a git repo with one commit (no remote). */
export function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: dir,
    stdio: "ignore",
  });
}

/** Commit a single file with a given message. */
export function commitFile(
  dir: string,
  filename: string,
  content: string,
  message: string,
): void {
  writeFileSync(join(dir, filename), content);
  execSync(`git add -A && git commit -m "${message}"`, {
    cwd: dir,
    stdio: "ignore",
  });
}

/**
 * Set up a repo with a bare remote + clone, an initial commit pushed to the
 * remote, plus a feature branch with one commit. Returns the path to the
 * clone (repoDir).
 *
 * Shared by pr-lifecycle-ansi.test.ts and pr-lifecycle-stdin.test.ts.
 */
export function initRepoWithRemoteAndBranch(
  dir: string,
  branch: string,
): string {
  const remoteDir = join(dir, "remote.git");
  const repoDir = join(dir, "repo");
  mkdirSync(remoteDir, { recursive: true });
  execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" });
  execSync(`git clone "${remoteDir}" repo`, { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: "ignore" });
  writeFileSync(join(repoDir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  execSync("git push", { cwd: repoDir, stdio: "ignore" });
  execSync(`git checkout -b "${branch}"`, { cwd: repoDir, stdio: "ignore" });
  writeFileSync(join(repoDir, "feature.txt"), "feature\n");
  execSync('git add -A && git commit -m "feat: add feature"', {
    cwd: repoDir,
    stdio: "ignore",
  });
  return repoDir;
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

/**
 * Build a `ConfigValues` object for tests with sensible defaults.
 *
 * Every key starts at its `DEFAULTS` value (from `src/config.ts`), then
 * the caller's `overrides` are spread on top. This replaces the duplicated
 * per-file `makeResolvedConfig()` helpers — tests that only need plain
 * config values can use `makeTestConfig()` directly.
 *
 * @example
 *   const cfg = makeTestConfig({ agentCommand: "echo hi", maxStuck: 1 });
 *   expect(cfg.agentCommand).toBe("echo hi");
 *   expect(cfg.baseBranch).toBe("main"); // default preserved
 */
export function makeTestConfig(
  overrides?: Partial<ConfigValues>,
): ConfigValues {
  return { ...DEFAULTS, ...overrides };
}

/**
 * Build a `ResolvedConfig` for tests with sensible defaults.
 *
 * Every key starts at its `DEFAULTS` value wrapped with `source: "default"`.
 * Plain-value `overrides` are merged on top (keeping `source: "default"`),
 * then `resolvedOverrides` are applied last — these carry an explicit
 * `{ value, source }` pair so tests can verify source-dependent behaviour.
 *
 * @example
 *   // All defaults, agentCommand overridden with default source:
 *   const rc = makeTestResolvedConfig({ agentCommand: "echo hi" });
 *   // rc.agentCommand === { value: "echo hi", source: "default" }
 *
 *   // Explicit source:
 *   const rc2 = makeTestResolvedConfig(undefined, {
 *     agentCommand: { value: "claude -p", source: "config" },
 *   });
 *   // rc2.agentCommand === { value: "claude -p", source: "config" }
 */
export function makeTestResolvedConfig(
  overrides?: Partial<RalphaiConfig>,
  resolvedOverrides?: Partial<
    Record<keyof RalphaiConfig, { value: unknown; source: ConfigSource }>
  >,
): ResolvedConfig {
  const merged = { ...DEFAULTS, ...overrides };
  const resolved: Record<string, { value: unknown; source: string }> = {};
  for (const [key, value] of Object.entries(merged)) {
    resolved[key] = { value, source: "default" };
  }
  if (resolvedOverrides) {
    for (const [key, rv] of Object.entries(resolvedOverrides)) {
      resolved[key] = rv!;
    }
  }
  return resolved as unknown as ResolvedConfig;
}

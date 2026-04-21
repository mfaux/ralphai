import { execFileSync, execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { beforeEach, afterEach } from "bun:test";
import { stripAnsi } from "./utils.ts";
import { runRalphai } from "./ralphai.ts";
import { ExitIntercepted } from "./interactive/maintenance-actions.ts";
import {
  DEFAULTS,
  getConfigFilePath,
  type AgentConfig,
  type ConfigSource,
  type ConfigValues,
  type GateConfig,
  type GitConfig,
  type HooksConfig,
  type IssueConfig,
  type PrConfig,
  type PromptConfig,
  type RalphaiConfig,
  type ResolvedConfig,
  type ResolvedValue,
  type WorkspaceOverrides,
} from "./config.ts";

/**
 * Like `Partial<RalphaiConfig>` but nested group objects are also partial.
 * This lets callers write `{ agent: { command: "echo" } }` without
 * specifying every field inside the group.
 */
export type PartialRalphaiConfig = {
  agent?: Partial<AgentConfig>;
  hooks?: Partial<HooksConfig>;
  gate?: Partial<GateConfig>;
  prompt?: Partial<PromptConfig>;
  pr?: Partial<PrConfig>;
  git?: Partial<GitConfig>;
  issue?: Partial<IssueConfig>;
  baseBranch?: string;
  sandbox?: "none" | "docker";
  dockerImage?: string;
  dockerMounts?: string;
  dockerEnvVars?: string;
  workspaces?: Record<string, WorkspaceOverrides> | null;
};

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
 * Deep-merge two config objects. Only merges group objects (agent, hooks,
 * gate, prompt, pr, git, issue); flat keys are overwritten directly.
 */
function deepMergeConfig(
  base: RalphaiConfig,
  overrides: PartialRalphaiConfig,
): RalphaiConfig {
  const result = { ...base };
  const groups = [
    "agent",
    "hooks",
    "gate",
    "prompt",
    "pr",
    "git",
    "issue",
  ] as const;
  for (const g of groups) {
    if (overrides[g] !== undefined) {
      result[g] = { ...base[g], ...overrides[g] } as never;
    }
  }
  if (overrides.baseBranch !== undefined)
    result.baseBranch = overrides.baseBranch;
  if (overrides.sandbox !== undefined) result.sandbox = overrides.sandbox;
  if (overrides.dockerImage !== undefined)
    result.dockerImage = overrides.dockerImage;
  if (overrides.dockerMounts !== undefined)
    result.dockerMounts = overrides.dockerMounts;
  if (overrides.dockerEnvVars !== undefined)
    result.dockerEnvVars = overrides.dockerEnvVars;
  if (overrides.workspaces !== undefined)
    result.workspaces = overrides.workspaces;
  return result;
}

/**
 * Build a `ConfigValues` object for tests with sensible defaults.
 *
 * Every key starts at its `DEFAULTS` value (from `src/config.ts`), then
 * the caller's `overrides` are deep-merged on top.
 *
 * @example
 *   const cfg = makeTestConfig({ agent: { command: "echo hi" } });
 *   expect(cfg.agent.command).toBe("echo hi");
 *   expect(cfg.baseBranch).toBe("main"); // default preserved
 */
export function makeTestConfig(overrides?: PartialRalphaiConfig): ConfigValues {
  if (!overrides)
    return {
      ...DEFAULTS,
      agent: { ...DEFAULTS.agent },
      hooks: { ...DEFAULTS.hooks },
      gate: { ...DEFAULTS.gate },
      prompt: { ...DEFAULTS.prompt },
      pr: { ...DEFAULTS.pr },
      git: { ...DEFAULTS.git },
      issue: { ...DEFAULTS.issue },
    };
  return deepMergeConfig(DEFAULTS, overrides);
}

/**
 * Wrap a group's plain values with ResolvedValue metadata.
 */
function wrapGroup<T extends object>(
  group: T,
  source: ConfigSource = "default",
): { [K in keyof T]: ResolvedValue<T[K]> } {
  const out: Record<string, ResolvedValue<unknown>> = {};
  for (const [k, v] of Object.entries(group)) {
    out[k] = { value: v, source };
  }
  return out as { [K in keyof T]: ResolvedValue<T[K]> };
}

/**
 * Build a `ResolvedConfig` for tests with sensible defaults.
 *
 * Every key starts at its `DEFAULTS` value wrapped with `source: "default"`.
 * Plain-value `overrides` are deep-merged on top (keeping `source: "default"`).
 *
 * For fine-grained source control, directly mutate the returned object,
 * e.g.:
 *   const rc = makeTestResolvedConfig();
 *   rc.agent.command = { value: "claude -p", source: "config" };
 *
 * @example
 *   const rc = makeTestResolvedConfig({ agent: { command: "echo hi" } });
 *   // rc.agent.command === { value: "echo hi", source: "default" }
 */
export function makeTestResolvedConfig(
  overrides?: PartialRalphaiConfig,
): ResolvedConfig {
  const merged = overrides ? deepMergeConfig(DEFAULTS, overrides) : DEFAULTS;
  return {
    agent: wrapGroup(merged.agent),
    hooks: wrapGroup(merged.hooks),
    gate: wrapGroup(merged.gate),
    prompt: wrapGroup(merged.prompt),
    pr: wrapGroup(merged.pr),
    docker: wrapGroup(merged.docker),
    git: wrapGroup(merged.git),
    issue: wrapGroup(merged.issue),
    baseBranch: { value: merged.baseBranch, source: "default" },
    sandbox: { value: merged.sandbox, source: "default" },
    dockerImage: { value: merged.dockerImage, source: "default" },
    dockerMounts: { value: merged.dockerMounts, source: "default" },
    dockerEnvVars: { value: merged.dockerEnvVars, source: "default" },
    workspaces: { value: merged.workspaces, source: "default" },
  };
}

/**
 * Create `env()` and `writeGlobalConfig()` helpers scoped to a
 * `useTempDir()` context.
 *
 * Eliminates the identical helper pair that was copy-pasted across
 * every `resolveConfig` test file.
 *
 * @example
 *   const ctx = useTempDir();
 *   const { env, writeGlobalConfig } = makeConfigTestHelpers(ctx);
 */
export function makeConfigTestHelpers(ctx: { dir: string }) {
  function env(
    extra?: Record<string, string>,
  ): Record<string, string | undefined> {
    return { RALPHAI_HOME: join(ctx.dir, "home"), ...extra };
  }

  function writeGlobalConfig(
    cwd: string,
    config: Record<string, unknown>,
  ): void {
    const filePath = getConfigFilePath(cwd, env());
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config));
  }

  return { env, writeGlobalConfig };
}

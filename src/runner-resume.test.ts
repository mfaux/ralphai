import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { type ResolvedConfig } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { runRunner, type RunnerOptions } from "./runner.ts";

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-resume-test-"));
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# test\n");
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function createManagedWorktree(mainDir: string, slug: string): string {
  const worktreeDir = join(tmpdir(), `runner-resume-wt-${slug}-${Date.now()}`);
  execSync(`git worktree add "${worktreeDir}" -b "ralphai/${slug}" HEAD`, {
    cwd: mainDir,
    stdio: "pipe",
  });
  return worktreeDir;
}

function setupGlobalPipeline(cwd: string): {
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
} {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  return getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
}

function makeResolvedConfig(
  overrides: Partial<Record<string, unknown>> = {},
): ResolvedConfig {
  const defaults: Record<string, unknown> = {
    agentCommand: "echo",
    feedbackCommands: "",
    baseBranch: "main",
    maxStuck: 3,
    issueSource: "none",
    standaloneLabel: "ralphai-standalone",
    subissueLabel: "ralphai-subissue",
    prdLabel: "ralphai-prd",
    issueRepo: "",
    issueCommentProgress: "true",
    issueHitlLabel: "ralphai-subissue-hitl",
    iterationTimeout: 0,
    autoCommit: "false",
    sandbox: "none",
    workspaces: null,
    ...overrides,
  };

  const resolved: Record<string, { value: unknown; source: string }> = {};
  for (const [key, value] of Object.entries(defaults)) {
    resolved[key] = { value, source: "default" };
  }
  return resolved as unknown as ResolvedConfig;
}

describe("runRunner — resume", () => {
  let dir: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.RALPHAI_HOME;
    dir = createTmpGitRepo();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.RALPHAI_HOME;
    else process.env.RALPHAI_HOME = savedHome;
  });

  test("resume initializes a missing progress log before the first iteration", async () => {
    const { wipDir, archiveDir } = setupGlobalPipeline(dir);
    const slug = "resume-missing-progress";
    const worktreeDir = createManagedWorktree(dir, slug);
    const planDir = join(wipDir, slug);
    const planFile = join(planDir, `${slug}.md`);
    const progressFile = join(planDir, "progress.md");

    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      planFile,
      "# Plan: Resume Missing Progress\n\nImplement the resume fix.\n",
    );

    const agentScript = `bash -c 'N=$RALPHAI_NONCE; if [ ! -f "${progressFile}" ]; then echo "missing progress file" >&2; exit 11; fi; printf "<promise nonce=\\"$N\\">COMPLETE</promise>\n<learnings nonce=\\"$N\\">none</learnings>\n"'`;

    const opts: RunnerOptions = {
      config: makeResolvedConfig({
        agentCommand: agentScript,
        autoCommit: "true",
      }),
      cwd: worktreeDir,
      isWorktree: true,
      mainWorktree: dir,
      dryRun: false,
      resume: true,
      allowDirty: false,
      once: false,
    };

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await runRunner(opts);
    } finally {
      console.log = origLog;
    }

    const archivedProgressFile = join(archiveDir, slug, "progress.md");
    expect(existsSync(progressFile)).toBe(false);
    expect(existsSync(archivedProgressFile)).toBe(true);
    expect(readFileSync(archivedProgressFile, "utf-8")).toBe(
      "## Progress Log\n\n",
    );

    const output = logs.join("\n");
    expect(output).toContain(`Resuming on existing branch: ralphai/${slug}`);
    expect(output).toContain(`Initialized ${progressFile}`);
    expect(output).not.toContain(`Resuming — keeping existing ${progressFile}`);
  });
});

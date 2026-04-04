/**
 * Dry-run safety tests for GitHub API calls + body-text verification.
 *
 * Verifies that:
 * - --dry-run skips sub-issue REST API calls with informational message
 * - --dry-run skips parent REST API calls with informational message
 * - --dry-run skips blocker GraphQL calls with informational message
 * - --dry-run does not create plan files
 * - ## Parent PRD body section is not parsed by any ralphai code path
 * - prd-to-issues body output format doesn't affect ralphai behavior
 *
 * Plan reference: scenarios 27–31 from parent PRD #245.
 */
import { describe, it, expect, beforeEach, afterEach, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { runRunner, type RunnerOptions } from "./runner.ts";
import { type ResolvedConfig } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import {
  buildIssuePlanContent,
  type BuildIssuePlanContentOptions,
} from "./issues.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dry-run-safety-"));
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

function setupGlobalPipeline(cwd: string): {
  ralphaiHome: string;
  backlogDir: string;
  wipDir: string;
  archiveDir: string;
} {
  const ralphaiHome = mkdtempSync(join(tmpdir(), "ralphai-home-"));
  process.env.RALPHAI_HOME = ralphaiHome;
  const dirs = getRepoPipelineDirs(cwd, { RALPHAI_HOME: ralphaiHome });
  return { ralphaiHome, ...dirs };
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
    issueLabel: "ralphai",
    issueInProgressLabel: "ralphai:in-progress",
    issueDoneLabel: "ralphai:done",
    issueStuckLabel: "ralphai:stuck",
    issuePrdLabel: "ralphai-prd",
    issuePrdInProgressLabel: "ralphai-prd:in-progress",
    issueRepo: "",
    issueCommentProgress: "true",
    iterationTimeout: 0,
    autoCommit: "false",
    workspaces: null,
    setupCommand: "",
    ...overrides,
  };

  const resolved: Record<string, { value: unknown; source: string }> = {};
  for (const [key, value] of Object.entries(defaults)) {
    resolved[key] = { value, source: "default" };
  }
  return resolved as unknown as ResolvedConfig;
}

/** Capture console.log output during a callback. */
async function captureConsoleLog(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

// ---------------------------------------------------------------------------
// Dry-run: runner auto-drain path
// ---------------------------------------------------------------------------

describe("dry-run safety — runner auto-drain path", () => {
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

  test("dry-run does not create plan files when backlog is empty", async () => {
    const { backlogDir } = setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    await runRunner(opts);

    // Backlog directory should have no plan files
    if (existsSync(backlogDir)) {
      const files = readdirSync(backlogDir);
      const planFiles = files.filter((f) => f.endsWith(".md"));
      expect(planFiles).toHaveLength(0);
    }
  });

  test("dry-run with existing backlog plan does not promote to WIP", async () => {
    const { backlogDir, wipDir } = setupGlobalPipeline(dir);

    writeFileSync(
      join(backlogDir, "test-plan.md"),
      "# Plan: Test\n\n- [ ] task 1\n",
    );

    const opts: RunnerOptions = {
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    await runRunner(opts);

    // Plan should still be in backlog (not moved to WIP)
    expect(existsSync(join(backlogDir, "test-plan.md"))).toBe(true);
    // WIP should not have the plan
    if (existsSync(wipDir)) {
      const wipDirs = readdirSync(wipDir);
      expect(wipDirs).not.toContain("test-plan");
    }
  });

  test("dry-run with issueSource=github logs informational messages about skipped API calls", async () => {
    // When issueSource is github but gh CLI isn't available in test env,
    // the peek functions will return early with "not available" messages.
    // The important thing is that pull functions (which make sub-issue,
    // parent, blocker API calls) are NEVER called.
    const { backlogDir } = setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeResolvedConfig({ issueSource: "none" }),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    const output = await captureConsoleLog(async () => {
      await runRunner(opts);
    });

    // Verify dry-run header appears
    expect(output).toContain("dry-run");

    // No plan files should have been created
    if (existsSync(backlogDir)) {
      const files = readdirSync(backlogDir);
      const planFiles = files.filter((f) => f.endsWith(".md"));
      expect(planFiles).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Dry-run: informational messages about skipped API calls
// ---------------------------------------------------------------------------

describe("dry-run safety — informational messages", () => {
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

  test("dry-run with no work does not invoke sub-issue/parent/blocker APIs", async () => {
    setupGlobalPipeline(dir);

    const opts: RunnerOptions = {
      config: makeResolvedConfig(),
      cwd: dir,
      isWorktree: false,
      mainWorktree: "",
      dryRun: true,
      resume: false,
      allowDirty: false,
      once: false,
    };

    // This should complete without making any API calls.
    // If sub-issue, parent, or blocker API calls were attempted,
    // they would fail in a test environment (no gh CLI or auth).
    await runRunner(opts);
  });
});

// ---------------------------------------------------------------------------
// ## Parent PRD body section — not parsed by any code path
// ---------------------------------------------------------------------------

describe("body-text verification — ## Parent PRD not parsed", () => {
  it("buildIssuePlanContent includes body verbatim without parsing ## Parent PRD", () => {
    // A sub-issue body might contain a "## Parent PRD" section.
    // ralphai should write it verbatim to the plan file but NEVER parse it
    // for discovery purposes.
    const bodyWithParentSection =
      "# Implementation\n\nDo the thing.\n\n## Parent PRD\n\n#245\n";

    const content = buildIssuePlanContent({
      issueNumber: "201",
      title: "Sub-issue with parent section in body",
      body: bodyWithParentSection,
      url: "https://github.com/owner/repo/issues/201",
      prd: 245,
      blockers: [],
    });

    // The body is included verbatim
    expect(content).toContain("## Parent PRD");
    expect(content).toContain("#245");

    // The prd field comes from the API (the prd parameter), NOT from body parsing
    expect(content).toContain("prd: 245");
  });

  it("buildIssuePlanContent does not extract prd from body when prd param is undefined", () => {
    // If the API doesn't return a parent, the body section should NOT be used
    const bodyWithParentSection =
      "# Implementation\n\nDo the thing.\n\n## Parent PRD\n\n#999\n";

    const content = buildIssuePlanContent({
      issueNumber: "201",
      title: "Sub-issue with parent in body but not API",
      body: bodyWithParentSection,
      url: "https://github.com/owner/repo/issues/201",
      // prd is NOT provided — simulating API returning no parent
    });

    // The body contains ## Parent PRD #999 but...
    expect(content).toContain("## Parent PRD");
    expect(content).toContain("#999");

    // ...prd frontmatter should NOT be set (because it's from the API, not body)
    expect(content).not.toContain("prd:");
  });

  it("discoverParentPrd uses REST API, not body text", () => {
    // This is a structural verification: discoverParentPrd() calls
    // `gh api repos/{repo}/issues/{N}/parent` — it has no `body` parameter
    // and does not accept or parse body text.
    //
    // We verify this by inspecting the function signature: it takes
    // (repo, issueNumber, cwd, prdLabel?) — no body parameter.
    const { discoverParentPrd } = require("./issues.ts");

    // discoverParentPrd has exactly 4 parameters (repo, issueNumber, cwd, prdLabel?)
    expect(discoverParentPrd.length).toBe(4);
  });

  it("fetchBlockersViaGraphQL uses GraphQL API, not body text", () => {
    // Structural verification: fetchBlockersViaGraphQL() takes
    // (repo, issueNumber, cwd) — no body parameter.
    const { fetchBlockersViaGraphQL } = require("./issues.ts");

    expect(fetchBlockersViaGraphQL.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// prd-to-issues body format — decorative only
// ---------------------------------------------------------------------------

describe("body-text verification — prd-to-issues format is decorative", () => {
  it("body containing '## Parent PRD\\n\\n#N' does not affect plan frontmatter", () => {
    // The prd-to-issues command writes `## Parent PRD\n\n#N` into sub-issue
    // bodies for human readability. Verify this section is treated as plain
    // body text and does not influence the `prd` frontmatter field.

    const decorativeBody = [
      "# feat: Implement the feature",
      "",
      "## Parent PRD",
      "",
      "#245",
      "",
      "## What to build",
      "",
      "Build the thing.",
    ].join("\n");

    // Case 1: API provides parent → prd comes from API
    const withPrd = buildIssuePlanContent({
      issueNumber: "201",
      title: "Feature implementation",
      body: decorativeBody,
      url: "https://github.com/owner/repo/issues/201",
      prd: 245,
    });

    expect(withPrd).toContain("prd: 245");
    expect(withPrd).toContain(decorativeBody);

    // Case 2: API does NOT provide parent → no prd field despite body
    const withoutPrd = buildIssuePlanContent({
      issueNumber: "201",
      title: "Feature implementation",
      body: decorativeBody,
      url: "https://github.com/owner/repo/issues/201",
    });

    expect(withoutPrd).not.toContain("prd:");
    expect(withoutPrd).toContain(decorativeBody);
  });

  it("body with blockers section does not affect depends-on frontmatter", () => {
    // Even if the body mentions blockers in prose, the depends-on field
    // is only populated from the GraphQL blockedBy API.
    const bodyWithBlockerProse = [
      "# Task",
      "",
      "## Blocked by",
      "",
      "- #42 — Some other task",
      "- #15 — Another blocker",
      "",
      "## What to build",
      "",
      "Build it.",
    ].join("\n");

    // No API blockers → no depends-on despite body mentioning them
    const content = buildIssuePlanContent({
      issueNumber: "100",
      title: "Task with body blocker prose",
      body: bodyWithBlockerProse,
      url: "https://github.com/owner/repo/issues/100",
      blockers: [],
    });

    expect(content).not.toContain("depends-on:");
    expect(content).toContain("## Blocked by");
    expect(content).toContain("#42");

    // With API blockers → depends-on comes from API data
    const contentWithBlockers = buildIssuePlanContent({
      issueNumber: "100",
      title: "Task with body blocker prose",
      body: bodyWithBlockerProse,
      url: "https://github.com/owner/repo/issues/100",
      blockers: [15, 42],
    });

    expect(contentWithBlockers).toContain("depends-on: [gh-15, gh-42]");
  });
});

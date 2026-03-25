import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath, writeConfigFile } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

// ---------------------------------------------------------------------------
// GitHub Issues integration
// ---------------------------------------------------------------------------

describe("GitHub Issues integration", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("init --yes defaults issueSource to none in config", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const parsed = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(parsed.issueSource).toBe("none");
  });

  it("init --yes includes issueSource as none in JSON config", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const parsed = JSON.parse(readFileSync(configPath(), "utf-8"));
    // issueSource should be "none" by default (all 17 keys are explicit)
    expect(parsed.issueSource).toBe("none");
  });

  it("init --yes output does not contain GitHub label info", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);

    expect(output).not.toContain("GitHub labels");
    expect(output).not.toContain("Label a GitHub issue");
  });
});

// ---------------------------------------------------------------------------
// build_continuous_pr_body function
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "build_continuous_pr_body function",
  () => {
    let prDir: string;
    let backlogDir: string;

    beforeEach(() => {
      prDir = join(
        tmpdir(),
        `ralphai-pr-body-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      backlogDir = join(prDir, "backlog");
      mkdirSync(backlogDir, { recursive: true });
      // Initialize a git repo so git log works
      execSync(
        "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git commit --allow-empty -m 'init'",
        {
          cwd: prDir,
          stdio: "ignore",
        },
      );
    });

    afterEach(() => {
      if (existsSync(prDir)) {
        rmSync(prDir, { recursive: true, force: true });
      }
    });

    /** Helper: run build_continuous_pr_body with given completed plans and backlog files */
    function buildBody(
      completedPlans: string[],
      backlogFiles: string[],
    ): string {
      // Create backlog plan files
      for (const f of backlogFiles) {
        writeFileSync(join(backlogDir, f), `# ${f}\n`);
      }

      const completedArr = completedPlans
        .map((p) => JSON.stringify(p))
        .join(" ");
      const script = `#!/bin/bash
BACKLOG_DIR=${JSON.stringify(backlogDir)}
BASE_BRANCH="main"
COMPLETED_PLANS=(${completedArr})

build_continuous_pr_body() {
  local body=""

  body+="## Completed Plans"$'\\n\\n'
  if [[ \${#COMPLETED_PLANS[@]} -gt 0 ]]; then
    for p in "\${COMPLETED_PLANS[@]}"; do
      body+="- [x] $p"$'\\n'
    done
  else
    body+="_None yet._"$'\\n'
  fi

  local remaining=()
  for f in "$BACKLOG_DIR"/*.md; do
    [[ -f "$f" ]] && remaining+=("$(basename "$f")")
  done

  body+=$'\\n'"## Remaining Plans"$'\\n\\n'
  if [[ \${#remaining[@]} -gt 0 ]]; then
    for r in "\${remaining[@]}"; do
      body+="- [ ] $r"$'\\n'
    done
  else
    body+="_Backlog empty — all plans processed._"$'\\n'
  fi

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."\$(git rev-parse --abbrev-ref HEAD)" --oneline --no-decorate 2>/dev/null || true)
  body+=$'\\n'"## Commits"$'\\n\\n'
  body+='\`\`\`'$'\\n'
  body+="\${commit_log:-_No commits._}"$'\\n'
  body+='\`\`\`'

  echo "$body"
}

build_continuous_pr_body
`;
      const scriptFile = join(prDir, "test-pr-body.sh");
      writeFileSync(scriptFile, script);
      const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
        cwd: prDir,
        encoding: "utf-8",
      });
      return result;
    }

    it("lists completed plans with checkmarks", () => {
      const body = buildBody(["prd-auth.md", "prd-api.md"], ["prd-ui.md"]);
      expect(body).toContain("- [x] prd-auth.md");
      expect(body).toContain("- [x] prd-api.md");
    });

    it("lists remaining backlog plans as unchecked", () => {
      const body = buildBody(["prd-auth.md"], ["prd-ui.md", "prd-db.md"]);
      expect(body).toContain("- [ ] prd-ui.md");
      expect(body).toContain("- [ ] prd-db.md");
    });

    it("shows none-yet when no plans completed", () => {
      const body = buildBody([], ["prd-ui.md"]);
      expect(body).toContain("_None yet._");
    });

    it("shows backlog-empty when all plans processed", () => {
      const body = buildBody(["prd-auth.md"], []);
      expect(body).toContain("_Backlog empty — all plans processed._");
    });

    it("includes Commits section", () => {
      const body = buildBody(["prd-auth.md"], []);
      expect(body).toContain("## Commits");
    });
  },
);

// ---------------------------------------------------------------------------
// Status subcommand
// ---------------------------------------------------------------------------

describe("status subcommand", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  it("shows help text with status command listed", () => {
    const result = runCli([], ctx.dir, testEnv());
    const output = stripLogo(result.stdout);
    expect(output).toContain("status");
  });

  it("status fails when ralphai is not initialized", () => {
    const result = runCli(["status"], ctx.dir, testEnv());
    const combined = result.stdout + result.stderr;
    expect(result.exitCode).toBe(1);
    expect(combined).toContain("not set up");
  });

  it("status shows empty pipeline", () => {
    // Initialize ralphai
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Pipeline");
    expect(output).toContain("Backlog");
    expect(output).toContain("0 plans");
    expect(output).toContain("In Progress");
    expect(output).toContain("Completed");
  });

  it("status shows backlog plans", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    writeFileSync(
      join(backlogDir, "prd-auth.md"),
      "# Auth\n\n### Task 1: Login\n### Task 2: Signup\n",
    );
    writeFileSync(
      join(backlogDir, "prd-search.md"),
      "---\ndepends-on: [prd-auth.md]\n---\n\n# Search\n\n### Task 1: Index\n",
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("3 plans"); // hello-ralphai.md + prd-auth.md + prd-search.md
    expect(output).toContain("prd-auth.md");
    expect(output).toContain("prd-search.md");
    expect(output).toContain("waiting on prd-auth.md");
  });

  it("status shows in-progress plan with task progress from receipt", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "prd-dark-mode");
    mkdirSync(planDir, { recursive: true });

    // Plan with 3 tasks
    writeFileSync(
      join(planDir, "prd-dark-mode.md"),
      "# Dark Mode\n\n### Task 1: Theme\n### Task 2: Toggle\n### Task 3: Persist\n",
    );

    // Progress file with 1 completed task
    writeFileSync(
      join(planDir, "progress.md"),
      "## Progress Log\n\n### Task 1: Theme\n\n**Status:** Complete\n",
    );

    // Receipt for this plan — includes tasks_completed
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "worktree_path=/tmp/wt-dark-mode",
        "branch=ralphai/dark-mode",
        "slug=dark-mode",
        "tasks_completed=1",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("In Progress");
    expect(output).toContain("1 plan");
    expect(output).toContain("prd-dark-mode.md");
    expect(output).toContain("1 of 3 tasks");
    expect(output).toContain("worktree: prd-dark-mode");
  });

  it("status shows 0 tasks_completed for receipt without tasks_completed field", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "prd-legacy");
    mkdirSync(planDir, { recursive: true });

    // Plan with 2 tasks
    writeFileSync(
      join(planDir, "prd-legacy.md"),
      "# Legacy\n\n### Task 1: Migrate\n### Task 2: Validate\n",
    );

    // Receipt WITHOUT tasks_completed (backwards compatibility)
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/legacy",
        "slug=legacy",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("0 of 2 tasks");
  });

  it("status shows tasks_completed from receipt, not progress.md", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "prd-feature");
    mkdirSync(planDir, { recursive: true });

    // Plan with 4 tasks
    writeFileSync(
      join(planDir, "prd-feature.md"),
      "# Feature\n\n### Task 1: A\n### Task 2: B\n### Task 3: C\n### Task 4: D\n",
    );

    // Progress file with 2 completed tasks
    writeFileSync(
      join(planDir, "progress.md"),
      "## Progress Log\n\n### Task 1: A\n**Status:** Complete\n\n### Task 2: B\n**Status:** Complete\n",
    );

    // Receipt says 3 tasks completed (receipt is authoritative)
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/feature",
        "slug=feature",
        "tasks_completed=3",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    // Should show 3 (from receipt), not 2 (from progress.md parsing)
    expect(output).toContain("3 of 4 tasks");
  });

  it("status shows orphaned receipt as a problem", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const orphanDir = join(ipDir, "orphan");
    mkdirSync(orphanDir, { recursive: true });

    // Receipt with no matching plan file
    writeFileSync(
      join(orphanDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/orphan",
        "slug=orphan",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Problems");
    expect(output).toContain("Orphaned receipt: orphan/receipt.txt");
  });

  it("status counts completed plans from archive", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const authDir = join(outDir, "prd-auth");
    const searchDir = join(outDir, "prd-search");
    mkdirSync(authDir, { recursive: true });
    mkdirSync(searchDir, { recursive: true });

    // Two archived plans
    writeFileSync(join(authDir, "prd-auth.md"), "# Auth\n");
    writeFileSync(join(searchDir, "prd-search.md"), "# Search\n");

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Completed");
    expect(output).toContain("2 plans");
    // Completed plans list their deduplicated file names
    expect(output).toContain("prd-auth.md");
    expect(output).toContain("prd-search.md");
  });

  it("status pairs non-prd plan with receipt via plan_file field", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "remove-fallback-agents");
    mkdirSync(planDir, { recursive: true });

    // Plan without prd- prefix (e.g. hand-named plan)
    writeFileSync(
      join(planDir, "remove-fallback-agents.md"),
      "# Remove Fallback Agents\n\n### Task 1: Remove\n### Task 2: Test\n### Task 3: Docs\n",
    );

    // Receipt with plan_file field pointing to the non-prd plan
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/remove-fallback-agents",
        "slug=remove-fallback-agents",
        "plan_file=remove-fallback-agents.md",
        "tasks_completed=2",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    // Plan shows up in in-progress with correct task progress
    expect(output).toContain("remove-fallback-agents.md");
    expect(output).toContain("2 of 3 tasks");
    // No orphaned receipt warning
    expect(output).not.toContain("Problems");
    expect(output).not.toContain("Orphaned");
  });

  it("status pairs gh-prefixed plan with receipt via plan_file field", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "gh-42-search");
    mkdirSync(planDir, { recursive: true });

    // Plan from issue intake (gh- prefix)
    writeFileSync(
      join(planDir, "gh-42-search.md"),
      "# Search Feature\n\n### Task 1: Index\n### Task 2: Query\n",
    );

    // Receipt with plan_file field for the gh-prefixed plan
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "worktree_path=/tmp/wt-gh-42-search",
        "branch=ralphai/gh-42-search",
        "slug=gh-42-search",
        "plan_file=gh-42-search.md",
        "tasks_completed=1",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("gh-42-search.md");
    expect(output).toContain("1 of 2 tasks");
    expect(output).toContain("worktree: gh-42-search");
    expect(output).not.toContain("Problems");
    expect(output).not.toContain("Orphaned");
  });

  it("status counts completed non-prd plans from archive", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { archiveDir: outDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const agentsDir = join(outDir, "remove-fallback-agents");
    const searchDir = join(outDir, "gh-42-search");
    const authDir = join(outDir, "prd-auth");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(searchDir, { recursive: true });
    mkdirSync(authDir, { recursive: true });

    // Archived plans with various naming conventions
    writeFileSync(
      join(agentsDir, "remove-fallback-agents.md"),
      "# Remove Fallback Agents\n",
    );
    writeFileSync(join(searchDir, "gh-42-search.md"), "# Search\n");
    writeFileSync(join(authDir, "prd-auth.md"), "# Auth\n");

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Completed");
    expect(output).toContain("3 plans");
    expect(output).toContain("remove-fallback-agents.md");
    expect(output).toContain("gh-42-search.md");
    expect(output).toContain("prd-auth.md");
  });

  it("status shows outcome when receipt has outcome field", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "prd-stuck-plan");
    mkdirSync(planDir, { recursive: true });

    writeFileSync(
      join(planDir, "prd-stuck-plan.md"),
      "# Stuck Plan\n\n### Task 1: A\n### Task 2: B\n",
    );

    // Receipt with outcome=stuck
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/stuck-plan",
        "slug=stuck-plan",
        "tasks_completed=1",
        "outcome=stuck",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[stuck]");
    expect(output).not.toContain("[in progress]");
  });

  it("status shows [in progress] when receipt has no outcome", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const { wipDir: ipDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    const planDir = join(ipDir, "prd-active");
    mkdirSync(planDir, { recursive: true });

    writeFileSync(
      join(planDir, "prd-active.md"),
      "# Active\n\n### Task 1: Do\n",
    );

    // Receipt without outcome field
    writeFileSync(
      join(planDir, "receipt.txt"),
      [
        "started_at=2026-03-07T12:00:00Z",
        "branch=ralphai/active",
        "slug=active",
        "tasks_completed=0",
      ].join("\n"),
    );

    const result = runCli(["status"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("[in progress]");
  });
});

// ---------------------------------------------------------------------------
// doctor subcommand
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("doctor subcommand", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("shows help text with doctor command listed", () => {
    const result = runCli([], ctx.dir, testEnv());
    const output = stripLogo(result.stdout);
    expect(output).toContain("doctor");
  });

  it("doctor --help shows doctor-specific help", () => {
    const result = runCli(["doctor", "--help"], ctx.dir, testEnv());
    const output = result.stdout + result.stderr;
    expect(output).toContain("ralphai doctor");
    expect(output).toContain("diagnostic");
  });

  it("doctor in fully initialized directory reports all checks passing", () => {
    // Create an initial commit on main so detectBaseBranch and base branch check work
    execSync(
      "git config user.email 'test@test.com' && git config user.name 'Test'",
      { cwd: ctx.dir, stdio: "ignore" },
    );
    execSync("git checkout -b main", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    writeFileSync(join(ctx.dir, "seed.txt"), "seed");
    // Ignore the RALPHAI_HOME dir so global config doesn't dirty the worktree
    writeFileSync(join(ctx.dir, ".gitignore"), ".ralphai-home/\n");
    execSync("git add -A && git commit -m 'init'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    // Initialize ralphai (after main branch exists so baseBranch is detected correctly)
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Seed a plan so the backlog check passes (init --yes no longer creates samples)
    const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
    writeFileSync(
      join(backlogDir, "seed-plan.md"),
      "# Seed\n\n### Task 1: Do\n",
    );

    // Commit ralphai files so working tree is clean
    execSync("git add -A && git commit -m 'add ralphai'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    // Override agentCommand to something in PATH and feedbackCommands to a passing command
    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    config.agentCommand = "true";
    config.feedbackCommands = ["true"];
    writeConfigFile(ctx.dir, config, testEnv());

    const result = runCli(["doctor"], ctx.dir, { ...testEnv(), NO_COLOR: "1" });
    const output = result.stdout;

    // All checks should pass
    expect(output).toContain("\u2713"); // checkmark
    expect(output).not.toContain("\u2717"); // x-mark
    expect(output).toContain("config initialized (global state)");
    expect(output).toContain("config.json valid");
    expect(output).toContain("git repo detected");
    expect(output).toContain("agent: true");
    expect(output).toContain("found in PATH");
    expect(output).toContain("All checks passed");
    expect(result.exitCode).toBe(0);
  });

  it("doctor without config reports first check as failed", () => {
    // Don't run init -- no config
    // Without config the doctor should still run and report failures

    const result = runCli(["doctor"], ctx.dir, { ...testEnv(), NO_COLOR: "1" });
    const output = result.stdout;

    expect(output).toContain("\u2717"); // x-mark
    expect(output).toContain("config not found");
    expect(result.exitCode).toBe(1);
  });

  it("doctor with unreachable agent command shows failure", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Set an agent command that won't be found in PATH
    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    config.agentCommand = "nonexistent-agent-binary-xyz";
    writeConfigFile(ctx.dir, config, testEnv());

    const result = runCli(["doctor"], ctx.dir, { ...testEnv(), NO_COLOR: "1" });
    const output = result.stdout;

    expect(output).toContain("\u2717"); // x-mark
    expect(output).toContain("nonexistent-agent-binary-xyz");
    expect(output).toContain("not found in PATH");
    expect(result.exitCode).toBe(1);
  });

  it("doctor exit code is 0 when only warnings (no failures)", () => {
    // Create an initial commit on main so detectBaseBranch and base branch check work
    execSync(
      "git config user.email 'test@test.com' && git config user.name 'Test'",
      { cwd: ctx.dir, stdio: "ignore" },
    );
    execSync("git checkout -b main", {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    writeFileSync(join(ctx.dir, "seed.txt"), "seed");
    // Ignore the RALPHAI_HOME dir so global config doesn't dirty the worktree
    writeFileSync(join(ctx.dir, ".gitignore"), ".ralphai-home/\n");
    execSync("git add -A && git commit -m 'init'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    // Initialize ralphai (after main branch exists so baseBranch is detected correctly)
    runCli(["init", "--yes"], ctx.dir, testEnv());

    // Commit ralphai files so we have a clean base
    execSync("git add -A && git commit -m 'add ralphai'", {
      cwd: ctx.dir,
      stdio: "ignore",
    });

    // Override agentCommand to something in PATH
    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    config.agentCommand = "true";
    // Set feedback commands to something that fails (to produce a warning, not a failure)
    config.feedbackCommands = ["false"];
    writeConfigFile(ctx.dir, config, testEnv());

    // Make the working tree dirty (uncommitted change) — produces a warning
    writeFileSync(join(ctx.dir, "dirty.txt"), "dirty");

    const result = runCli(["doctor"], ctx.dir, { ...testEnv(), NO_COLOR: "1" });
    const output = result.stdout;

    // Should have warnings but no failures
    expect(output).toContain("\u26A0"); // warning sign
    expect(output).toContain("warning");
    // Exit code should be 0 (warnings don't count as failures)
    expect(result.exitCode).toBe(0);
  });
});

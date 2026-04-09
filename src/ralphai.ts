import { execSync } from "child_process";
import { execQuiet as execQuietFn } from "./exec.ts";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
} from "fs";
import { join, resolve } from "path";
import * as clack from "@clack/prompts";
import { RESET, DIM, TEXT } from "./utils.ts";
import { runSelfUpdate } from "./self-update.ts";
import {
  listPlanFolders,
  listPlanFiles,
  resolvePlanPath,
  planExistsForSlug,
  getPlanDescription,
} from "./plan-detection.ts";
import {
  parseReceipt,
  checkReceiptSource,
  findPlansByBranch,
} from "./receipt.ts";
import {
  getRepoPipelineDirs,
  resolveRepoByNameOrPath,
  removeStaleRepos,
} from "./global-state.ts";
import {
  detectFeedbackCommands,
  detectWorkspaces,
  detectProject,
  detectSetupCommand,
} from "./project-detection.ts";
import { runRunner, type RunnerOptions, type RunnerResult } from "./runner.ts";
import {
  resolveConfig,
  parseCLIArgs,
  ConfigError,
  getConfigFilePath,
  writeConfigFile,
  DEFAULTS,
  detectDockerAvailable,
} from "./config.ts";
import { formatShowConfig } from "./show-config.ts";
import { IN_PROGRESS_LABEL, DONE_LABEL, STUCK_LABEL } from "./labels.ts";
import {
  prdTransitionInProgress,
  prdTransitionDone,
} from "./label-lifecycle.ts";
import { runUninstall, showUninstallHelp } from "./uninstall.ts";
import { runRepos, showReposHelp } from "./repos.ts";
import { runConfigCommand, showConfigCommandHelp } from "./config-cmd.ts";
import { runRalphaiStop, showStopHelp } from "./stop.ts";
import { runClean, showCleanHelp } from "./clean.ts";
import { runRalphaiDoctor, showDoctorHelp } from "./doctor.ts";
import { runRalphaiStatus, showStatusHelp } from "./status.ts";
import { runHitl } from "./hitl.ts";

import { extractIssueFrontmatter, extractDependsOn } from "./frontmatter.ts";
import {
  findHitlBlockers,
  formatPrdHitlSummary,
  type BlockedSubIssue,
} from "./prd-hitl.ts";
import {
  AGENTS_MD_HEADER,
  AGENTS_MD_RALPHAI_SECTION,
} from "./agents-md-template.ts";
import {
  detectIssueRepo,
  fetchPrdIssueByNumber,
  fetchIssueTitleByNumber,
  fetchIssueWithLabels,
  discoverParentIssue,
  issueBranchName,
  commitTypeFromTitle,
  pullGithubIssueByNumber,
  pullGithubIssues,
  pullPrdSubIssue,
  slugify,
} from "./issues.ts";
import type { PrdIssue, PullIssueOptions } from "./issues.ts";
import { discoverPrdTarget } from "./prd-discovery.ts";
import type { PrdDiscoveryResult } from "./prd-discovery.ts";
import {
  classifyIssue,
  validateStandalone,
  validateSubissue,
} from "./issue-dispatch.ts";
import { restoreIssueLabels } from "./reset-labels.ts";
import { createPrdPr } from "./pr-lifecycle.ts";
import {
  isInsideGitRepo,
  extractExecStderr,
  detectBaseBranch,
} from "./git-helpers.ts";
import { parseRalphaiOptions } from "./parse-options.ts";
import type {
  RalphaiSubcommand,
  RalphaiOptions,
  WizardAnswers,
} from "./parse-options.ts";
import {
  HELLO_WORLD_PLAN,
  HELLO_WORLD_SLUG,
  runSeed,
  runBacklogDir,
} from "./seed.ts";
import {
  isGitWorktree,
  resolveWorktreeInfo,
  executeSetupCommand,
  ensureRepoHasCommit,
  prepareWorktree,
  listRalphaiWorktrees,
  selectPlanForWorktree,
} from "./worktree/index.ts";
import type {
  WorktreeEntry,
  SelectedWorktreePlan,
  GitHubFallbackOptions,
  SetupSandboxConfig,
} from "./worktree/index.ts";
import { parseFeedbackCommands } from "./feedback-wrapper.ts";
import { runConfigWizard } from "./interactive/run-wizard.ts";

// ---------------------------------------------------------------------------
// Agent presets
// ---------------------------------------------------------------------------

const AGENT_PRESETS: { label: string; command: string }[] = [
  { label: "OpenCode", command: "opencode run --agent build" },
  { label: "Claude Code", command: "claude -p" },
  { label: "Codex", command: "codex exec" },
  { label: "Gemini CLI", command: "gemini -p" },
  { label: "Aider", command: "aider --message" },
  { label: "Goose", command: "goose run -t" },
  { label: "Kiro", command: "kiro-cli chat --no-interactive" },
  { label: "Amp", command: "amp -x" },
];

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

async function runWizard(cwd: string): Promise<WizardAnswers | null> {
  clack.intro("Setting up Ralphai — autonomous runner");

  clack.note(
    "Ralphai picks up plan files from the backlog and drives an AI coding agent\n" +
      "to implement them autonomously, with built-in feedback loops, git hygiene,\n" +
      "and safety rails.",
    "What is Ralphai?",
  );

  // 1. Agent CLI tool
  const agentSelection = await clack.select({
    message: "Which AI coding agent CLI do you use?",
    options: [
      ...AGENT_PRESETS.map((preset) => ({
        value: preset.command,
        label: preset.label,
        hint: preset.command,
      })),
      { value: "__custom__", label: "Custom", hint: "Enter your own command" },
    ],
  });

  if (clack.isCancel(agentSelection)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  let agentCommand: string;
  if (agentSelection === "__custom__") {
    const customCommand = await clack.text({
      message: "Enter the agent CLI command prefix:",
      placeholder: "e.g. my-agent run --prompt",
      validate: (value) => {
        if (!value.trim()) return "Command cannot be empty";
      },
    });

    if (clack.isCancel(customCommand)) {
      clack.cancel("Setup cancelled.");
      return null;
    }
    agentCommand = customCommand;
  } else {
    agentCommand = agentSelection;
  }

  // 2. Base branch
  const detectedBranch = detectBaseBranch(cwd);
  const baseBranch = await clack.text({
    message: "Base branch for PRs:",
    initialValue: detectedBranch,
    validate: (value) => {
      if (!value.trim()) return "Branch name cannot be empty";
    },
  });

  if (clack.isCancel(baseBranch)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 3. Feedback commands (auto-detected from project type)
  const project = detectProject(cwd);
  const detectedFeedback = project ? project.feedbackCommands.join(",") : "";
  const feedbackPlaceholder = project
    ? project.feedbackCommands.join(", ") || "<build command>, <test command>"
    : "<build command>, <test command>";
  const feedbackCommands = await clack.text({
    message: detectedFeedback
      ? `Feedback commands (auto-detected for ${project!.label}):`
      : "Feedback commands (comma-separated, or leave empty):",
    initialValue: detectedFeedback || undefined,
    placeholder: detectedFeedback ? undefined : feedbackPlaceholder,
    defaultValue: detectedFeedback || "",
  });

  if (clack.isCancel(feedbackCommands)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 3b. PR feedback commands (slow E2E/integration tests)
  const detectedPrFeedback = project
    ? project.prFeedbackCommands.join(",")
    : "";
  const prFeedbackCommands = await clack.text({
    message:
      "Slow commands to run only before creating a PR (e.g. E2E or integration tests):",
    initialValue: detectedPrFeedback || undefined,
    placeholder: detectedPrFeedback
      ? undefined
      : "e.g. npm run test:e2e, npm run cypress:run",
    defaultValue: detectedPrFeedback || "",
  });

  if (clack.isCancel(prFeedbackCommands)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 4. Setup command (runs in worktree before agent starts)
  const detectedSetup = detectSetupCommand(cwd);
  const setupCommand = await clack.text({
    message: detectedSetup
      ? `Setup command (runs in worktree before agent starts, auto-detected for ${project?.label ?? "project"}):`
      : "Setup command (runs in worktree before agent starts, or leave empty):",
    initialValue: detectedSetup || undefined,
    placeholder: detectedSetup ? undefined : "e.g. npm install",
    defaultValue: detectedSetup || "",
  });

  if (clack.isCancel(setupCommand)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 5. Docker sandboxing
  const dockerAvailable = detectDockerAvailable();
  const sandboxConfirm = await clack.confirm({
    message: dockerAvailable
      ? "Enable Docker sandboxing? (recommended — Docker detected)"
      : "Enable Docker sandboxing? (Docker not detected)",
    initialValue: dockerAvailable,
  });

  if (clack.isCancel(sandboxConfirm)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  const sandbox: "none" | "docker" = sandboxConfirm ? "docker" : "none";

  let autoCommit = false;

  // 6. GitHub Issues integration (enabled by default)
  clack.note(
    "When Ralphai's backlog is empty, it will automatically pull the oldest\n" +
      `open issue labeled "${DEFAULTS.standaloneLabel}" and convert it to a plan.\n` +
      "Disable this if you use a different issue tracker.",
    "GitHub Issues",
  );

  const disableIssues = await clack.confirm({
    message: "Enable GitHub Issues integration?",
    initialValue: true,
  });

  if (clack.isCancel(disableIssues)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  const enableIssues = disableIssues;

  // 7. Update AGENTS.md
  const agentsMdPath = join(cwd, "AGENTS.md");
  const agentsMdExists = existsSync(agentsMdPath);
  const agentsMdHasSection =
    agentsMdExists &&
    /^## Ralphai\b/m.test(readFileSync(agentsMdPath, "utf-8"));

  let updateAgentsMd = false;
  if (!agentsMdHasSection) {
    const updateAnswer = await clack.confirm({
      message: agentsMdExists
        ? "Add a Ralphai section to AGENTS.md? This helps coding agents discover Ralphai outside of runs."
        : "Create AGENTS.md with a Ralphai section? This helps coding agents discover Ralphai outside of runs.",
      initialValue: true,
    });

    if (clack.isCancel(updateAnswer)) {
      clack.cancel("Setup cancelled.");
      return null;
    }

    updateAgentsMd = updateAnswer;
  }

  // 8. Sample plan
  const createSamplePlan = await clack.confirm({
    message: "Create a sample plan to try your first run?",
    initialValue: true,
  });

  if (clack.isCancel(createSamplePlan)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  return {
    agentCommand,
    setupCommand: setupCommand || "",
    baseBranch,
    feedbackCommands: feedbackCommands || "",
    prFeedbackCommands: prFeedbackCommands || "",
    autoCommit,
    sandbox,
    issueSource: enableIssues ? "github" : "none",
    updateAgentsMd,
    createSamplePlan,
  };
}

// ---------------------------------------------------------------------------
// GitHub label creation
// ---------------------------------------------------------------------------

interface LabelResult {
  success: boolean;
  error?: string;
}

interface LabelNames {
  standalone: string;
  subissue: string;
  prd: string;
}

/** Build a `gh label create` command string for a given label. */
function ghLabelCreateCmd(
  name: string,
  description: string,
  color: string,
): string {
  // Quote label names that contain special characters (colons, spaces, etc.)
  const quotedName = /[\s:]/.test(name) ? `"${name}"` : name;
  return `gh label create ${quotedName} --description "${description}" --color ${color} --force`;
}

/** The label definitions with their descriptions and colors.
 *
 * Produces 6 labels: 3 family labels (standalone, subissue, prd) with
 * distinct colors, plus 3 shared state labels (in-progress, done, stuck)
 * with shared colors. Issues carry their family label through all states;
 * state labels are added/removed as the issue progresses.
 */
function labelDefs(names: LabelNames) {
  // Intake colors — one per family
  const STANDALONE_INTAKE_COLOR = "7057ff"; // purple
  const SUBISSUE_INTAKE_COLOR = "c5def5"; // light blue
  const PRD_INTAKE_COLOR = "1d76db"; // blue

  // Shared state colors
  const IN_PROGRESS_COLOR = "fbca04"; // yellow
  const DONE_COLOR = "0e8a16"; // green
  const STUCK_COLOR = "d93f0b"; // red

  return [
    // Family labels
    {
      name: names.standalone,
      description: "Ralphai picks up this standalone issue",
      color: STANDALONE_INTAKE_COLOR,
    },
    {
      name: names.subissue,
      description: "Ralphai picks up this PRD sub-issue",
      color: SUBISSUE_INTAKE_COLOR,
    },
    {
      name: names.prd,
      description: "Ralphai PRD — groups sub-issues for drain runs",
      color: PRD_INTAKE_COLOR,
    },
    // Shared state labels
    {
      name: IN_PROGRESS_LABEL,
      description: "Ralphai is working on this issue",
      color: IN_PROGRESS_COLOR,
    },
    {
      name: DONE_LABEL,
      description: "Ralphai finished this issue",
      color: DONE_COLOR,
    },
    {
      name: STUCK_LABEL,
      description: "Ralphai is stuck on this issue",
      color: STUCK_COLOR,
    },
  ];
}

/**
 * Create issue-tracking labels on the GitHub repo. Uses `gh label create
 * --force` so it is idempotent. Never throws — label creation is best-effort.
 *
 * Creates 12 labels: 3 families (standalone, subissue, prd) × 4 states.
 */
function ensureGitHubLabels(
  cwd: string,
  names: LabelNames,
  dryRun = false,
): LabelResult {
  if (dryRun) {
    const defs = labelDefs(names);
    for (const label of defs) {
      console.log(`[dry-run] Would create label: ${label.name}`);
    }
    return { success: true };
  }

  try {
    // Check gh is available
    execSync("gh --version", { cwd, stdio: "pipe" });
  } catch {
    return {
      success: false,
      error: "gh CLI not found. Install it from https://cli.github.com/",
    };
  }

  try {
    // Check gh is authenticated
    execSync("gh auth status", { cwd, stdio: "pipe" });
  } catch {
    return {
      success: false,
      error: "gh CLI is not authenticated. Run: gh auth login",
    };
  }

  try {
    for (const label of labelDefs(names)) {
      execSync(ghLabelCreateCmd(label.name, label.description, label.color), {
        cwd,
        stdio: "pipe",
      });
    }
    return { success: true };
  } catch {
    const manual = labelDefs(names)
      .map((l) => `  ${ghLabelCreateCmd(l.name, l.description, l.color)}`)
      .join("\n");
    return {
      success: false,
      error: `Could not create labels. Create them manually:\n${manual}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Scaffold logic
// ---------------------------------------------------------------------------

function scaffold(answers: WizardAnswers, cwd: string): void {
  // Generate config (JSON format) — all 15 keys with explicit defaults
  const feedbackCommands = answers.feedbackCommands
    ? answers.feedbackCommands
        .split(",")
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd.length > 0)
    : [];

  const prFeedbackCommands = answers.prFeedbackCommands
    ? answers.prFeedbackCommands
        .split(",")
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd.length > 0)
    : [];

  const configObj: Record<
    string,
    | string
    | string[]
    | number
    | boolean
    | Record<string, { feedbackCommands: string[] }>
  > = {
    agentCommand: answers.agentCommand,
    feedbackCommands,
    prFeedbackCommands,
    baseBranch: answers.baseBranch,
    setupCommand: answers.setupCommand ?? "",
    autoCommit: answers.autoCommit ?? false,
    iterationTimeout: 0,
    issueSource: answers.issueSource ?? "none",
    standaloneLabel: DEFAULTS.standaloneLabel,
    subissueLabel: DEFAULTS.subissueLabel,
    prdLabel: DEFAULTS.prdLabel,
    issueRepo: "",
    issueCommentProgress: true,
    sandbox: answers.sandbox ?? "none",
  };

  // Conditionally include workspaces to keep config clean for single-project repos
  if (answers.workspaces && Object.keys(answers.workspaces).length > 0) {
    configObj.workspaces = answers.workspaces;
  }

  // Write config to global state (~/.ralphai/repos/<id>/config.json)
  const configPath = writeConfigFile(cwd, configObj);

  // Update or create AGENTS.md with a Ralphai section
  let agentsMdAction: "created" | "updated" | null = null;
  if (answers.updateAgentsMd) {
    const agentsMdPath = join(cwd, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
      const content = readFileSync(agentsMdPath, "utf-8");
      if (!/^## Ralphai\b/m.test(content)) {
        writeFileSync(
          agentsMdPath,
          content.trimEnd() + "\n\n" + AGENTS_MD_RALPHAI_SECTION,
        );
        agentsMdAction = "updated";
      }
    } else {
      writeFileSync(agentsMdPath, AGENTS_MD_HEADER + AGENTS_MD_RALPHAI_SECTION);
      agentsMdAction = "created";
    }
  }

  // Create GitHub labels if issues integration is enabled
  const initLabelNames: LabelNames = {
    standalone: configObj.standaloneLabel as string,
    subissue: configObj.subissueLabel as string,
    prd: configObj.prdLabel as string,
  };
  let labelResult: LabelResult | null = null;
  if (answers.issueSource === "github") {
    labelResult = ensureGitHubLabels(cwd, initLabelNames);
  }

  // Create sample plan in backlog
  let samplePlanCreated = false;
  if (answers.createSamplePlan) {
    const { backlogDir } = getRepoPipelineDirs(cwd);
    mkdirSync(backlogDir, { recursive: true });
    const samplePlanPath = join(backlogDir, `${HELLO_WORLD_SLUG}.md`);
    if (!existsSync(samplePlanPath)) {
      writeFileSync(samplePlanPath, HELLO_WORLD_PLAN);
      samplePlanCreated = true;
    }
  }

  // Print success output
  console.log(`${TEXT}Ralphai initialized${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(
    `  config.json                ${DIM}Configuration at ${configPath}${RESET}`,
  );
  if (labelResult) {
    if (labelResult.success) {
      console.log(
        `  GitHub labels              ${DIM}Created 6 labels (3 family + 3 shared state):${RESET}`,
      );
      console.log(
        `    ${TEXT}${configObj.standaloneLabel}${RESET}       ${DIM}Family label for standalone issues${RESET}`,
      );
      console.log(
        `    ${TEXT}${configObj.subissueLabel}${RESET}         ${DIM}Family label for PRD sub-issues${RESET}`,
      );
      console.log(
        `    ${TEXT}${configObj.prdLabel}${RESET}              ${DIM}Family label for PRD parent issues${RESET}`,
      );
      console.log(
        `                             ${DIM}Shared state: in-progress, done, stuck${RESET}`,
      );
    } else {
      console.log();
      console.log(`${TEXT}Warning:${RESET} ${DIM}${labelResult.error}${RESET}`);
    }
  }
  if (agentsMdAction) {
    console.log(
      `  AGENTS.md                  ${DIM}Ralphai section (${agentsMdAction})${RESET}`,
    );
  }
  if (samplePlanCreated) {
    console.log(
      `  hello-world.md           ${DIM}Sample plan in backlog${RESET}`,
    );
  }
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  if (samplePlanCreated) {
    console.log(`  A sample plan is ready.`);
    console.log(`  Run it:`);
    console.log(`       ${TEXT}$ ralphai run${RESET}`);
    console.log(`     ${DIM}Check progress or stop a running plan:${RESET}`);
    console.log(`       ${TEXT}$ ralphai status${RESET}`);
    console.log(`       ${TEXT}$ ralphai stop${RESET}`);
  } else {
    console.log(
      `  1. Write a plan in the backlog (run ${TEXT}ralphai backlog-dir${RESET} to find it)`,
    );
    console.log(`  2. Run it:`);
    console.log(`       ${TEXT}$ ralphai run${RESET}`);
    console.log(`     ${DIM}Check progress or stop a running plan:${RESET}`);
    console.log(`       ${TEXT}$ ralphai status${RESET}`);
    console.log(`       ${TEXT}$ ralphai stop${RESET}`);
  }
  if (answers.issueSource === "github") {
    console.log();
    console.log(
      `${DIM}Label a GitHub issue with "${configObj.standaloneLabel}" and Ralphai will pick it up automatically.${RESET}`,
    );
    console.log();
    console.log(
      `${DIM}Install the planning and TDD skills to let your coding agent create issues for Ralphai:${RESET}`,
    );
    console.log(`       ${TEXT}$ npx skills add mfaux/ralphai -g${RESET}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reset command
// ---------------------------------------------------------------------------

async function runRalphaiReset(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const { backlogDir, wipDir } = getRepoPipelineDirs(cwd);

  if (!existsSync(wipDir)) {
    console.log("Nothing to reset — no in-progress directory.");
    return;
  }

  const planSlugs = listPlanFolders(wipDir);
  const planFiles = planSlugs.map((slug) => `${slug}.md`);

  // Check for worktrees to clean
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(cwd);
  } catch {
    // Not in a git repo or git not available
  }

  if (planFiles.length === 0 && worktrees.length === 0) {
    console.log("Nothing to reset — pipeline is already clean.");
    return;
  }

  // Show what will be reset
  console.log();
  console.log(`${TEXT}The following will be reset:${RESET}`);
  console.log();
  if (planFiles.length > 0) {
    console.log(
      `  ${TEXT}Plans${RESET}       ${DIM}${planFiles.length} plan${planFiles.length !== 1 ? "s" : ""} moved back to backlog${RESET}`,
    );
    for (const f of planFiles) {
      console.log(`    ${DIM}${f}${RESET}`);
    }
    console.log(
      `  ${TEXT}Artifacts${RESET}   ${DIM}progress.md + receipt.txt removed per plan${RESET}`,
    );
  }
  if (worktrees.length > 0) {
    console.log(
      `  ${TEXT}Worktrees${RESET}   ${DIM}${worktrees.length} worktree${worktrees.length !== 1 ? "s" : ""} will be removed${RESET}`,
    );
    for (const wt of worktrees) {
      console.log(`    ${DIM}${wt.branch}  ${wt.path}${RESET}`);
    }
  }
  console.log();

  // Confirm unless --yes
  if (!options.yes) {
    clack.intro("Ralphai Reset");
    const confirmed = await clack.confirm({
      message:
        "Reset pipeline state? In-progress plans will return to backlog.",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Reset cancelled.");
      return;
    }
  }

  let actions = 0;

  // Load config to get issue repo for GitHub issue restoration.
  // Best-effort: if config resolution fails we skip label restoration.
  let issueRepo = "";
  try {
    const cfgResult = resolveConfig({
      cwd,
      envVars: process.env,
      cliArgs: [],
    });
    issueRepo = cfgResult.config.issueRepo.value;
  } catch {
    // Config resolution failure is not critical — skip label restoration.
  }

  // 1. Extract plan files from in-progress slug-folders back to backlog as flat files
  for (const slug of planSlugs) {
    const src = join(wipDir, slug);
    const planFile = join(src, `${slug}.md`);
    const dest = join(backlogDir, `${slug}.md`);
    mkdirSync(backlogDir, { recursive: true });

    // Restore GitHub issue labels before moving the file (needs frontmatter).
    if (existsSync(planFile)) {
      const labelResult = restoreIssueLabels({
        planPath: planFile,
        issueRepo,
        cwd,
      });
      if (labelResult.restored) {
        console.log(`  ${DIM}${labelResult.message}${RESET}`);
      }
    }

    rmSync(join(src, "progress.md"), { force: true });
    rmSync(join(src, "receipt.txt"), { force: true });
    if (existsSync(planFile)) {
      renameSync(planFile, dest);
    }
    rmSync(src, { recursive: true, force: true });
    actions++;
  }

  // 4. Clean worktrees
  if (worktrees.length > 0) {
    // Prune stale entries
    try {
      execSync("git worktree prune", { cwd, stdio: "pipe" });
    } catch {
      // Not critical
    }

    for (const wt of worktrees) {
      try {
        // Use --force because the worktree may have uncommitted changes
        // from interrupted agent work.
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd,
          stdio: "pipe",
        });
        // Force-delete branch (-D) because ralphai/* branches are typically
        // not merged to main yet. Non-force -d would silently fail, leaving
        // stale branches that cause dirty-state errors on the next run.
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd,
            stdio: "pipe",
          });
        } catch {
          // Branch deletion failure is not critical
        }
        actions++;
      } catch {
        console.log(
          `  ${DIM}Warning: Could not remove worktree ${wt.path}. Remove manually.${RESET}`,
        );
      }
    }
  }

  // Summary
  console.log(`${TEXT}Pipeline reset.${RESET}`);
  console.log();
  console.log(`${DIM}Actions:${RESET}`);
  if (planFiles.length > 0) {
    console.log(
      `  ${planFiles.length} plan${planFiles.length !== 1 ? "s" : ""} moved to backlog`,
    );
    console.log(
      `  Deleted progress.md and receipt.txt in ${planFiles.length} plan${planFiles.length !== 1 ? "s" : ""}`,
    );
  }
  if (worktrees.length > 0) {
    console.log(
      `  Cleaned ${worktrees.length} worktree${worktrees.length !== 1 ? "s" : ""}`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Reset single plan — exported for interactive mode
// ---------------------------------------------------------------------------

/**
 * Reset a single in-progress plan back to the backlog.
 *
 * Moves the plan file from the in-progress slug-folder to the backlog
 * directory, deletes progress.md and receipt.txt, removes the slug
 * folder, and cleans up any associated worktree.
 *
 * Skips confirmation — callers are expected to confirm before calling.
 */
export function resetPlanBySlug(cwd: string, slug: string): void {
  const { backlogDir, wipDir } = getRepoPipelineDirs(cwd);
  const slugDir = join(wipDir, slug);

  if (!existsSync(slugDir)) {
    console.log(`Plan '${slug}' not found in in-progress.`);
    return;
  }

  // Move plan file back to backlog
  const planFile = join(slugDir, `${slug}.md`);
  const dest = join(backlogDir, `${slug}.md`);
  mkdirSync(backlogDir, { recursive: true });

  // Restore GitHub issue labels before moving the file (needs frontmatter).
  if (existsSync(planFile)) {
    try {
      const cfgResult = resolveConfig({
        cwd,
        envVars: process.env,
        cliArgs: [],
      });
      const issueRepo = cfgResult.config.issueRepo.value;
      const labelResult = restoreIssueLabels({
        planPath: planFile,
        issueRepo,
        cwd,
      });
      if (labelResult.restored) {
        console.log(`  ${DIM}${labelResult.message}${RESET}`);
      }
    } catch {
      // Config resolution failure is not critical — skip label restoration.
    }
  }

  rmSync(join(slugDir, "progress.md"), { force: true });
  rmSync(join(slugDir, "receipt.txt"), { force: true });
  rmSync(join(slugDir, "runner.pid"), { force: true });
  if (existsSync(planFile)) {
    renameSync(planFile, dest);
  }
  rmSync(slugDir, { recursive: true, force: true });

  // Clean associated worktree
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(cwd);
  } catch {
    // Not in a git repo or git not available
  }

  for (const wt of worktrees) {
    // Match worktrees whose branch contains the slug
    if (wt.branch.includes(slug)) {
      try {
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd,
          stdio: "pipe",
        });
        try {
          execSync(`git branch -D "${wt.branch}"`, { cwd, stdio: "pipe" });
        } catch {
          // Branch deletion failure is not critical
        }
      } catch {
        console.log(
          `  ${DIM}Warning: Could not remove worktree ${wt.path}. Remove manually.${RESET}`,
        );
      }
    }
  }

  console.log(`Reset '${slug}' — plan moved back to backlog.`);
}

// ---------------------------------------------------------------------------
// purge — delete all archived artifacts from pipeline/out/
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// hitl — interactive agent session for HITL sub-issues
// ---------------------------------------------------------------------------

function showHitlHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai hitl <issue-number> [options]`);
  console.log();
  console.log(
    "Open an interactive agent session for a HITL (human-in-the-loop) sub-issue.",
  );
  console.log(
    "Discovers the parent PRD, resolves the worktree, assembles the prompt,",
  );
  console.log(
    "and spawns the agent interactively so you get the full TUI experience.",
  );
  console.log();
  console.log(`${TEXT}Arguments:${RESET}`);
  console.log(
    `  ${TEXT}<issue-number>${RESET}   ${DIM}GitHub issue number of the HITL sub-issue${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--dry-run, -n${RESET}    ${DIM}Preview what would happen without spawning the agent${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Requires:${RESET}`);
  console.log(
    `  ${TEXT}agentInteractiveCommand${RESET}  ${DIM}Set in config or RALPHAI_AGENT_INTERACTIVE_COMMAND env var${RESET}`,
  );
  console.log();
  console.log(`${TEXT}On exit:${RESET}`);
  console.log(
    `  ${DIM}Clean exit (code 0): removes HITL label, adds done label${RESET}`,
  );
  console.log(`  ${DIM}Abnormal exit: labels unchanged${RESET}`);
}

// ---------------------------------------------------------------------------

function showRalphaiHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai <command> [options]`);
  console.log();
  console.log(`${TEXT}Core${RESET}`);
  console.log(
    `  ${TEXT}run${RESET}         ${DIM}Run a plan in an isolated worktree (use --wizard/-w to configure interactively)${RESET}`,
  );
  console.log(
    `  ${TEXT}hitl${RESET}        ${DIM}Open interactive agent session for a HITL sub-issue${RESET}`,
  );
  console.log(
    `  ${TEXT}status${RESET}      ${DIM}Show pipeline status (auto-refreshes in terminal)${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Management${RESET}`);
  console.log(
    `  ${TEXT}clean${RESET}       ${DIM}Remove archived plans and orphaned worktrees${RESET}`,
  );
  console.log(
    `  ${TEXT}config${RESET}      ${DIM}Query resolved configuration${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Setup & Maintenance${RESET}`);
  console.log(
    `  ${TEXT}init${RESET}        ${DIM}Set up Ralphai in your project (interactive wizard)${RESET}`,
  );
  console.log(
    `  ${TEXT}update${RESET}      ${DIM}Update ralphai to the latest (or specified) version${RESET}`,
  );
  console.log(
    `  ${TEXT}uninstall${RESET}   ${DIM}Remove Ralphai from this project (or --global to uninstall)${RESET}`,
  );
  console.log(
    `  ${TEXT}doctor${RESET}      ${DIM}Check your ralphai setup for problems${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Plumbing${RESET}`);
  console.log(
    `  ${TEXT}stop${RESET}        ${DIM}Stop running plan(s)${RESET}`,
  );
  console.log(
    `  ${TEXT}reset${RESET}       ${DIM}Move in-progress plans back to backlog and clean up${RESET}`,
  );
  console.log(
    `  ${TEXT}repos${RESET}       ${DIM}List all known repos with pipeline summaries${RESET}`,
  );
  console.log(
    `  ${TEXT}seed${RESET}        ${DIM}Create a sample plan in the backlog${RESET}`,
  );
  console.log();
  console.log(
    `${DIM}Run 'ralphai <command> --help' for command-specific options.${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runRalphai(args: string[]): Promise<void> {
  const options = parseRalphaiOptions(args);
  let cwd = options.targetDir ? resolve(options.targetDir) : process.cwd();
  const helpRequested = args.includes("--help") || args.includes("-h");

  // Reject unknown commands (positional args that don't match any subcommand)
  if (options.unknownCommand) {
    console.error(`Unknown command: ${options.unknownCommand}`);
    console.error(
      `${DIM}Run ${TEXT}ralphai --help${RESET}${DIM} for available commands.${RESET}`,
    );
    process.exit(1);
  }

  // Handle --repo flag: resolve cwd from a known repo name or path
  if (options.repo) {
    const REPO_BLOCKED_COMMANDS = new Set<RalphaiSubcommand>(["run", "init"]);
    if (
      options.subcommand &&
      REPO_BLOCKED_COMMANDS.has(options.subcommand) &&
      !helpRequested
    ) {
      console.error(
        `--repo cannot be used with '${options.subcommand}'. Run this command from inside the repo.`,
      );
      process.exit(1);
    }

    const stateDir = resolveRepoByNameOrPath(options.repo);
    if (!stateDir) {
      console.error(`Repo not found: ${options.repo}`);
      console.error(
        `${DIM}Run ${TEXT}ralphai repos${DIM} to see known repos.${RESET}`,
      );
      process.exit(1);
    }

    // Read the stored repoPath from config to use as cwd
    const configPath = join(stateDir, "config.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (
          typeof config.repoPath === "string" &&
          existsSync(config.repoPath)
        ) {
          cwd = config.repoPath;
        } else {
          console.error(
            `Repo '${options.repo}' has a stale or missing path. Re-run ${TEXT}ralphai init${RESET} from the repo.`,
          );
          process.exit(1);
        }
      } catch {
        console.error(`Cannot read config for repo '${options.repo}'.`);
        process.exit(1);
      }
    }
  }

  // Subcommands that reject unknown flags (run/worktree pass through to runner)
  const STRICT_SUBCOMMANDS = new Set([
    "init",
    "status",
    "stop",
    "reset",
    "clean",
    "update",
    "uninstall",
    "doctor",
    "repos",
    "config",
  ]);
  if (
    options.subcommand &&
    STRICT_SUBCOMMANDS.has(options.subcommand) &&
    !helpRequested &&
    options.unknownFlags.length > 0
  ) {
    console.error(`Unknown flag: ${options.unknownFlags[0]}`);
    console.error(
      `${DIM}Run ${TEXT}ralphai ${options.subcommand} --help${RESET}${DIM} for usage.${RESET}`,
    );
    process.exit(1);
  }

  // --- Early git-repo guard for commands that require a working tree ---
  const GIT_REQUIRED_COMMANDS = new Set<RalphaiSubcommand>([
    "run",
    "init",
    "hitl",
  ]);
  if (
    options.subcommand &&
    GIT_REQUIRED_COMMANDS.has(options.subcommand) &&
    !helpRequested &&
    !isInsideGitRepo(cwd)
  ) {
    console.error("Not inside a git repository.");
    console.error();
    console.error(
      `To use ${TEXT}ralphai ${options.subcommand}${RESET}, navigate to a git repository first.`,
    );
    console.error(
      `${DIM}Use ${TEXT}ralphai repos${DIM} to see your initialized repos.${RESET}`,
    );
    process.exit(1);
  }

  // Housekeeping: remove stale repo entries (dead paths with empty pipelines).
  // Skip on --help (keep help output fast) and --dry-run (no side effects).
  const isDryRunGlobal = args.includes("--dry-run") || args.includes("-n");
  if (!helpRequested && !isDryRunGlobal) {
    try {
      removeStaleRepos();
    } catch {
      // Non-fatal — don't block the command if cleanup fails.
    }
  }

  switch (options.subcommand) {
    case "init":
      if (helpRequested) {
        showInitHelp();
        return;
      }
      await runRalphaiInit(options, cwd);
      break;
    case "update":
      if (helpRequested) {
        showUpdateHelp();
        return;
      }
      runSelfUpdate({
        packageName: "ralphai",
        tag: options.targetDir, // first positional arg after "update" is parsed as targetDir
      });
      break;
    case "uninstall":
      if (helpRequested) {
        showUninstallHelp();
        return;
      }
      await runUninstall({ yes: options.yes, global: options.global, cwd });
      break;
    case "run":
      await runRalphaiInManagedWorktree(options, cwd);
      break;
    case "status":
      if (helpRequested) {
        showStatusHelp();
        return;
      }
      runRalphaiStatus({ cwd, once: options.once });
      break;
    case "stop":
      if (helpRequested) {
        showStopHelp();
        return;
      }
      runRalphaiStop({
        cwd,
        dryRun: args.includes("--dry-run") || args.includes("-n"),
        slug: options.stopSlug,
        all: options.all,
      });
      break;
    case "reset":
      if (helpRequested) {
        showResetHelp();
        return;
      }
      await runRalphaiReset(options, cwd);
      break;
    case "clean":
      if (helpRequested) {
        showCleanHelp();
        return;
      }
      await runClean({
        cwd,
        yes: options.yes,
        worktrees: options.worktrees,
        archive: options.archive,
      });
      break;
    case "doctor":
      if (helpRequested) {
        showDoctorHelp();
        return;
      }
      runRalphaiDoctor(cwd);
      break;
    case "repos":
      if (helpRequested) {
        showReposHelp();
        return;
      }
      runRepos({ clean: options.clean });
      break;
    case "config":
      if (helpRequested) {
        showConfigCommandHelp();
        return;
      }
      runConfigCommand({
        cwd,
        key: options.configKey,
        check: options.checkCapabilities,
      });
      break;
    case "seed":
      runSeed(cwd);
      break;
    case "hitl":
      if (helpRequested) {
        showHitlHelp();
        return;
      }
      if (!options.hitlIssueNumber) {
        console.error(`${TEXT}Usage:${RESET} ralphai hitl <issue-number>`);
        console.error(
          `\n${DIM}Provide the GitHub issue number of the HITL sub-issue.${RESET}`,
        );
        process.exit(1);
      }
      await runHitl({
        issueNumber: options.hitlIssueNumber,
        cwd,
        dryRun: isDryRunGlobal,
        runArgs: options.runArgs,
      });
      break;
    case "worktree": {
      // The `worktree` subcommand has been removed. Print redirect guidance
      // based on the sub-subcommand (parsed as targetDir by the arg parser).
      const wtSub = options.targetDir;
      if (wtSub === "clean") {
        console.error(
          `The ${TEXT}ralphai worktree clean${RESET} command has been removed.`,
        );
        console.error(`Use ${TEXT}ralphai clean --worktrees${RESET} instead.`);
      } else if (wtSub === "list") {
        console.error(
          `The ${TEXT}ralphai worktree list${RESET} command has been removed.`,
        );
        console.error(`Use ${TEXT}ralphai status${RESET} instead.`);
      } else {
        console.error(
          `The ${TEXT}ralphai worktree${RESET} command has been removed.`,
        );
        console.error(`\n${DIM}Replacements:${RESET}`);
        console.error(
          `  ${TEXT}ralphai clean --worktrees${RESET}  ${DIM}(replaces worktree clean)${RESET}`,
        );
        console.error(
          `  ${TEXT}ralphai status${RESET}             ${DIM}(replaces worktree list)${RESET}`,
        );
      }
      process.exit(1);
    }
    default:
      showRalphaiHelp();
      break;
  }
}

// ---------------------------------------------------------------------------
// Doctor & diagnostics
// ---------------------------------------------------------------------------

/**
 * Check whether the first token of an agent command is reachable in PATH.
 * Returns the token name if NOT found, or null if it is found.
 */
function checkAgentCommandInPath(agentCommand: string): string | null {
  const token = agentCommand.trim().split(/\s+/)[0];
  if (!token) return null;
  try {
    execSync(`which ${token}`, { stdio: ["pipe", "pipe", "pipe"] });
    return null; // found
  } catch {
    return token; // not found
  }
}

/**
 * Probe the system for an installed agent binary from AGENT_PRESETS.
 * Checks Claude Code and OpenCode first (actively tested), then the rest.
 * Returns the first preset whose binary is found in PATH, or null.
 */
function detectInstalledAgent(): { label: string; command: string } | null {
  const probeOrder = [
    AGENT_PRESETS.find((p) => p.label === "Claude Code"),
    AGENT_PRESETS.find((p) => p.label === "OpenCode"),
    ...AGENT_PRESETS.filter(
      (p) => p.label !== "Claude Code" && p.label !== "OpenCode",
    ),
  ].filter((p): p is { label: string; command: string } => p !== undefined);

  for (const preset of probeOrder) {
    // checkAgentCommandInPath returns null when the binary IS found
    if (!checkAgentCommandInPath(preset.command)) {
      return preset;
    }
  }
  return null;
}

async function runRalphaiInit(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  if (isGitWorktree(cwd)) {
    console.error("Cannot initialize ralphai inside a git worktree.");
    console.error(
      `Run ${TEXT}ralphai init${RESET} from the main repository instead.`,
    );
    process.exit(1);
  }

  // Check if global config already exists
  const existingConfigPath = getConfigFilePath(cwd);
  if (existsSync(existingConfigPath)) {
    if (options.force) {
      // --force: overwrite the existing config
      if (!options.yes) {
        clack.intro("Force re-initializing Ralphai");

        const confirmed = await clack.confirm({
          message: "This will overwrite the existing config. Continue?",
        });

        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel("Force re-init cancelled.");
          return;
        }
      }
      // Fall through to normal scaffold below
    } else {
      console.error(
        `Ralphai is already configured for this repository.\n` +
          `${DIM}Use ${TEXT}ralphai init --force${DIM} to overwrite the config.${RESET}`,
      );
      process.exit(1);
    }
  }

  let answers: WizardAnswers;

  if (options.yes) {
    // Non-interactive mode with defaults (auto-detect feedback commands)
    const agentsMdPath = join(cwd, "AGENTS.md");
    const agentsMdHasSection =
      existsSync(agentsMdPath) &&
      /^## Ralphai\b/m.test(readFileSync(agentsMdPath, "utf-8"));

    // Resolve agent command: explicit flag > auto-detect > fallback
    let agentCommand = options.agentCommand;
    if (!agentCommand) {
      const detected = detectInstalledAgent();
      if (detected) {
        agentCommand = detected.command;
        console.log(
          `${DIM}Detected ${detected.label}${RESET} ${TEXT}— using '${detected.command}'${RESET}`,
        );
      } else {
        agentCommand = "opencode run --agent build";
        console.log(
          `${TEXT}No supported agent found in PATH — defaulting to OpenCode. Override with --agent-command=<cmd>${RESET}`,
        );
      }
    }

    const detectedProject = detectProject(cwd);
    const detectedFeedbackStr = detectedProject
      ? detectedProject.feedbackCommands.join(",")
      : "";
    const detectedPrFeedbackStr = detectedProject
      ? detectedProject.prFeedbackCommands.join(",")
      : "";
    const detectedSetupStr = detectSetupCommand(cwd);

    // Auto-detect Docker for sandbox
    const dockerDetected = detectDockerAvailable();
    const sandboxValue: "none" | "docker" = dockerDetected ? "docker" : "none";

    answers = {
      agentCommand,
      setupCommand: detectedSetupStr,
      baseBranch: detectBaseBranch(cwd),
      feedbackCommands: detectedFeedbackStr,
      prFeedbackCommands: detectedPrFeedbackStr,
      autoCommit: false,
      sandbox: sandboxValue,
      issueSource: "github",
      updateAgentsMd: !agentsMdHasSection,
      createSamplePlan: true,
    };

    // Print detection summary so users can verify auto-detected values
    const feedbackDisplay = answers.feedbackCommands.trim() || "(none)";
    const prFeedbackDisplay = answers.prFeedbackCommands.trim() || "(none)";
    const setupDisplay = answers.setupCommand.trim() || "(none)";
    console.log(`${DIM}Detected:${RESET}`);
    console.log(
      `  ${DIM}Agent:${RESET}     ${TEXT}${answers.agentCommand}${RESET}`,
    );
    console.log(
      `  ${DIM}Branch:${RESET}    ${TEXT}${answers.baseBranch}${RESET}`,
    );
    console.log(`  ${DIM}Feedback:${RESET}  ${TEXT}${feedbackDisplay}${RESET}`);
    console.log(
      `  ${DIM}PR feedback:${RESET} ${TEXT}${prFeedbackDisplay}${RESET}`,
    );
    console.log(`  ${DIM}Setup:${RESET}     ${TEXT}${setupDisplay}${RESET}`);
    console.log(
      `  ${DIM}Project:${RESET}   ${TEXT}${detectedProject?.label ?? "(none)"}${RESET}`,
    );
    console.log(
      `  ${DIM}Issues:${RESET}    ${TEXT}GitHub Issues (enabled)${RESET}`,
    );
    console.log(
      `  ${DIM}Sandbox:${RESET}   ${TEXT}${sandboxValue}${dockerDetected ? " (Docker detected)" : " (Docker not detected)"}${RESET}`,
    );

    // Workspace detection for --yes mode
    const workspaces = detectWorkspaces(cwd);
    if (workspaces.length > 0) {
      const MAX_WS_DISPLAY = 10;
      const allNames = workspaces.map((ws) => ws.name);
      const names =
        allNames.length <= MAX_WS_DISPLAY
          ? allNames.join(", ")
          : allNames.slice(0, MAX_WS_DISPLAY).join(", ") +
            `, ... and ${allNames.length - MAX_WS_DISPLAY} more`;
      console.log(
        `  ${DIM}Workspaces:${RESET} ${TEXT}${workspaces.length} packages${RESET} ${DIM}(${names})${RESET}`,
      );
      console.log(
        `${DIM}  Feedback commands will be auto-filtered by scope. Run ${TEXT}ralphai init${DIM} interactively to customize per-workspace commands.${RESET}`,
      );
    }

    console.log();
  } else {
    // Interactive wizard
    const wizardResult = await runWizard(cwd);
    if (!wizardResult) {
      // User cancelled
      return;
    }
    answers = wizardResult;

    // Workspace detection for interactive mode — show summary, no config generation.
    // Scoped feedback is auto-derived at runtime; the workspaces config key is an
    // escape hatch users add manually when they need custom overrides.
    const workspaces = detectWorkspaces(cwd);
    if (workspaces.length > 0) {
      const MAX_WS_DISPLAY = 10;
      const allNames = workspaces.map((ws) => ws.name);
      const names =
        allNames.length <= MAX_WS_DISPLAY
          ? allNames.join(", ")
          : allNames.slice(0, MAX_WS_DISPLAY).join(", ") +
            `, ... and ${allNames.length - MAX_WS_DISPLAY} more`;
      clack.log.info(
        `Detected ${workspaces.length} workspace packages: ${names}`,
      );
      clack.log.info(
        "Feedback commands will be auto-filtered by scope at runtime. Add custom overrides to the workspaces key in config.json if needed.",
      );
    }
  }

  // Warn if the agent binary isn't in PATH (soft warning, not a hard error)
  const missingBinary = checkAgentCommandInPath(answers.agentCommand);
  if (missingBinary) {
    const msg = `'${missingBinary}' not found in PATH — make sure it's installed before running.`;
    if (options.yes) {
      console.log(`${TEXT}Warning:${RESET} ${DIM}${msg}${RESET}`);
    } else {
      clack.log.warn(msg);
    }
  }

  // Warn if no feedback commands were detected — the agent won't get feedback
  if (!answers.feedbackCommands.trim()) {
    const msg =
      "No build/test/lint scripts detected. Your agent won't get feedback between iterations. Add feedbackCommands to config.json.";
    if (options.yes) {
      console.log(`${TEXT}Warning:${RESET} ${DIM}${msg}${RESET}`);
    } else {
      clack.log.warn(msg);
    }
  }

  scaffold(answers, cwd);
}

// ---------------------------------------------------------------------------
// Init subcommand
// ---------------------------------------------------------------------------

function showInitHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai init [options] [directory]`);
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--yes, -y${RESET}              ${DIM}Skip prompts and use defaults${RESET}`,
  );
  console.log(
    `  ${TEXT}--force${RESET}                ${DIM}Overwrite existing config${RESET}`,
  );
  console.log(
    `  ${TEXT}--agent-command=${RESET}<cmd>   ${DIM}Set the agent command (default: opencode run --agent build)${RESET}`,
  );
}

function showResetHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai reset [options]`);
  console.log();
  console.log(
    `${DIM}Move in-progress plans back to backlog and clean up worktrees.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--yes, -y${RESET}   ${DIM}Skip confirmation prompt${RESET}`,
  );
}

function showUpdateHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai update [tag]`);
  console.log();
  console.log(
    `${DIM}Update ralphai to the latest (or specified) version.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Examples:${RESET}`);
  console.log(
    `  ${DIM}$${RESET} ralphai update          ${DIM}# update to latest${RESET}`,
  );
  console.log(
    `  ${DIM}$${RESET} ralphai update beta     ${DIM}# install beta version${RESET}`,
  );
}

/** Known non-config flags accepted by `ralphai run`. */
const KNOWN_RUN_FLAGS = new Set([
  "--dry-run",
  "-n",
  "--resume",
  "-r",
  "--allow-dirty",
  "--once",
  "--show-config",
  "--wizard",
  "-w",
  "--help",
  "-h",
]);

/** Patterns for run flags parsed directly (not by config resolver). */
const RUN_FLAG_PATTERNS_EXTRA = [/^--plan=/];

/** Patterns for config flags that are parsed by the TS config resolver. */
const CONFIG_FLAG_PATTERNS = [
  /^--agent-command=/,
  /^--setup-command=/,
  /^--feedback-commands=/,
  /^--pr-feedback-commands=/,
  /^--base-branch=/,
  /^--max-stuck=/,
  /^--iteration-timeout=/,
  /^--auto-commit$/,
  /^--no-auto-commit$/,
  /^--review$/,
  /^--no-review$/,
  /^--prompt-mode=/,
  /^--sandbox=/,
  /^--docker-image=/,
  /^--docker-mounts=/,
  /^--docker-env-vars=/,
];

function isRecognizedRunFlag(arg: string): boolean {
  if (KNOWN_RUN_FLAGS.has(arg)) return true;
  if (RUN_FLAG_PATTERNS_EXTRA.some((p) => p.test(arg))) return true;
  return CONFIG_FLAG_PATTERNS.some((p) => p.test(arg));
}

function validateRunArgs(runArgs: string[]): void {
  for (const arg of runArgs) {
    if (!isRecognizedRunFlag(arg)) {
      console.error(`ERROR: Unrecognized argument: ${arg}`);
      showRunHelp();
      process.exit(1);
    }
  }
}

function showRunHelp(): void {
  const lines = [
    "Usage: ralphai run [<target>] [options]",
    "",
    "  Auto-detects work, creates or reuses a worktree, and runs there.",
    "  Ralphai commits on a feature branch, pushes it, and opens a draft PR when possible.",
    "",
    "Target (optional):",
    "  <number>                         GitHub issue number (e.g. 42) — fetches the issue, creates feat/<slug> branch",
    "  <file.md>                        Plan file path (e.g. my-feature.md) — runs that specific plan and stops",
    "  (omitted)                        Auto-detect from backlog or GitHub issues",
    "",
    "Options:",
    "  --dry-run, -n                    Preview what Ralphai would do without mutating state",
    "  --wizard, -w                     Interactively configure run options before starting",
    "  --once                           Run a single plan then exit (default: drain backlog)",
    "  --resume, -r                     Auto-commit dirty state and continue",
    "  --allow-dirty                    Skip the clean working tree check",
    "  --plan=<file>                    Target a specific backlog plan (default: auto-detect)",
    "  --agent-command=<command>        Override agent CLI command (e.g. 'claude -p')",
    "  --setup-command=<command>        Command to run in worktree after creation (e.g. 'bun install')",
    "  --feedback-commands=<list>       Comma-separated feedback commands (e.g. 'npm test,npm run build')",
    "  --pr-feedback-commands=<list>    Comma-separated PR feedback commands (run after PR creation)",
    "  --base-branch=<branch>           Override base branch (default: main)",
    "  --max-stuck=<n>                  Override stuck threshold (default: 3)",
    "  --iteration-timeout=<seconds>     Timeout per agent invocation (default: 0 = no timeout)",
    "  --auto-commit                    Enable auto-commit of agent changes (per-iteration and resume recovery)",
    "  --no-auto-commit                 Disable auto-commit recovery snapshots (default: off)",
    "  --sandbox=<mode>                 Execution sandbox mode: 'none' (local) or 'docker' (default: none)",
    "  --docker-image=<image>           Override Docker image (default: auto-resolve from agent name)",
    "  --docker-mounts=<csv>            Extra bind mounts for Docker sandbox (comma-separated)",
    "  --docker-env-vars=<csv>          Extra env vars to forward into Docker sandbox (comma-separated)",
    "  --review                         Enable review pass after completion (default: on)",
    "  --no-review                      Disable review pass after completion",
    "  --prompt-mode=<mode>             Prompt file ref format: 'auto', 'at-path', or 'inline' (default: auto)",
    "  --show-config                    Print resolved settings and exit",
    "  --help, -h                       Show this help message",
    "",
    "Config file: config.json (optional, JSON format, stored in ~/.ralphai/repos/<id>/)",
    "  Supported keys: agentCommand, setupCommand, feedbackCommands, prFeedbackCommands,",
    "                  baseBranch, maxStuck, sandbox, dockerImage, dockerMounts, dockerEnvVars,",
    "                  autoCommit, review, iterationTimeout, promptMode,",
    "                  issueSource, standaloneLabel, subissueLabel, prdLabel,",
    "                  issueRepo, issueCommentProgress",
    "",
    "Env var overrides: RALPHAI_AGENT_COMMAND, RALPHAI_SETUP_COMMAND,",
    "                   RALPHAI_FEEDBACK_COMMANDS,",
    "                   RALPHAI_PR_FEEDBACK_COMMANDS,",
    "                   RALPHAI_BASE_BRANCH, RALPHAI_MAX_STUCK,",
    "                   RALPHAI_AUTO_COMMIT, RALPHAI_SANDBOX,",
    "                   RALPHAI_DOCKER_IMAGE, RALPHAI_DOCKER_MOUNTS,",
    "                   RALPHAI_DOCKER_ENV_VARS, RALPHAI_REVIEW,",
    "                   RALPHAI_ITERATION_TIMEOUT,",
    "                   RALPHAI_PROMPT_MODE,",
    "                   RALPHAI_ISSUE_SOURCE,",
    "                   RALPHAI_STANDALONE_LABEL, RALPHAI_SUBISSUE_LABEL,",
    "                   RALPHAI_PRD_LABEL,",
    "                   RALPHAI_ISSUE_REPO,",
    "                   RALPHAI_ISSUE_COMMENT_PROGRESS",
    "",
    "Precedence: CLI flags > env vars > config file > built-in defaults",
    "",
    "Examples:",
    "  ralphai run                                             # auto-detect work and run",
    "  ralphai run 42                                          # fetch issue #42, create branch, run",
    "  ralphai run my-feature.md                               # run a specific plan file",
    "  ralphai run --dry-run                                   # preview only",
    "  ralphai run --once                                      # run a single plan then exit",
    "  ralphai run --resume                                    # recover dirty state and continue",
    "  ralphai run --agent-command='claude -p'                 # use Claude Code",
    "  ralphai run --agent-command='opencode run --agent build'  # use OpenCode",
    "  RALPHAI_AGENT_COMMAND='codex exec' ralphai run          # override via env var",
  ];
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Explicit target handlers: `ralphai run <issue-number>` / `ralphai run <plan.md>`
// ---------------------------------------------------------------------------

/**
 * Handle `ralphai run <issue-number>` — fetch the GitHub issue, determine
 * whether it is a PRD (has `ralphai-prd` label), and either:
 *
 * Label-driven dispatch: fetches the issue's labels, classifies the
 * dispatch family, validates, and routes to the appropriate handler:
 *
 * 1. **standalone** — pull the issue into a plan file, create a `feat/<slug>`
 *    branch and worktree, run the agent once, open a PR on completion.
 * 2. **subissue** — discover parent PRD, delegate to `runPrdIssueTarget()`
 *    which creates a shared `feat/<prd-slug>` branch.
 * 3. **prd** — discover sub-issues via `discoverPrdTarget()`, process
 *    sequentially on a shared branch.
 * 4. **No recognized label** — error with guidance.
 */
async function runIssueTarget(
  issueNumber: number,
  options: RalphaiOptions,
  runArgs: string[],
  cwd: string,
  flags: {
    isDryRun: boolean;
    hasHelp: boolean;
    hasShowConfig: boolean;
    setupCommand: string;
    feedbackCommands: string[];
    standaloneLabel: string;
    subissueLabel: string;
    prdLabel: string;
    setupSandboxConfig?: SetupSandboxConfig;
  },
): Promise<void> {
  const {
    isDryRun,
    hasHelp,
    hasShowConfig,
    setupCommand,
    feedbackCommands,
    standaloneLabel,
    subissueLabel,
    prdLabel,
    setupSandboxConfig,
  } = flags;

  // Pass through --help and --show-config unchanged
  if (hasHelp || hasShowConfig) {
    try {
      await runRalphaiRunner({ ...options, runArgs }, cwd);
    } catch {
      // runRalphaiRunner may call process.exit() on fatal errors
    }
    return;
  }

  // Validate run args (reject unrecognised flags)
  validateRunArgs(runArgs);

  if (isGitWorktree(cwd)) {
    console.error("'ralphai run' must be run from the main repository.");
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Detect GitHub repo
  const repo = detectIssueRepo(cwd);
  if (!repo) {
    console.error(
      "Could not detect GitHub repo from git remote. " +
        "Set issue-repo in config or ensure a remote is configured.",
    );
    process.exit(1);
  }

  // --- Dry-run: skip sub-issue, parent, and blocker API calls ---
  if (isDryRun) {
    // Only fetch the issue title (lightweight read — no sub-issues, parent,
    // or blocker queries). fetchIssueTitleByNumber is safe for dry-run.
    let issueTitle: string;
    try {
      const info = fetchIssueTitleByNumber(repo, issueNumber, cwd);
      issueTitle = info.title;
    } catch (err: unknown) {
      console.error(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        `\nCheck that issue #${issueNumber} exists and you have access to ${repo}.`,
      );
      process.exit(1);
    }

    const issueSlug = slugify(commitTypeFromTitle(issueTitle).description);
    const branch = issueBranchName(issueTitle);

    console.log();
    console.log("========================================");
    console.log("  Ralphai dry-run — issue target");
    console.log("========================================");
    console.log(`[dry-run] Issue: #${issueNumber} — ${issueTitle}`);
    console.log(`[dry-run] Branch: ${branch}`);
    console.log(`[dry-run] Worktree: ../.ralphai-worktrees/${issueSlug}/`);
    console.log(
      "[dry-run] Would fetch sub-issues via REST API (skipped in dry-run)",
    );
    console.log(
      "[dry-run] Would discover parent PRD via REST API (skipped in dry-run)",
    );
    console.log(
      "[dry-run] Would query blockers via GraphQL API (skipped in dry-run)",
    );
    console.log(
      "[dry-run] No plan files created, no worktrees created, no agent run executed.",
    );
    return;
  }

  // --- Label-driven dispatch ---
  // Fetch the issue with labels for classification.
  let issueInfo: import("./issues.ts").IssueWithLabels;
  try {
    issueInfo = fetchIssueWithLabels(repo, issueNumber, cwd);
  } catch (err: unknown) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      `\nCheck that issue #${issueNumber} exists and you have access to ${repo}.`,
    );
    process.exit(1);
  }

  // Classify the issue into a dispatch family based on its labels.
  const classification = classifyIssue(issueInfo.labels, {
    standaloneLabel,
    subissueLabel,
    prdLabel,
  });

  if (!classification.ok) {
    console.error(`ERROR: ${classification.message}`);
    process.exit(1);
  }

  // --- Dispatch: PRD ---
  if (classification.family === "prd") {
    // Use discoverPrdTarget to get sub-issues (it already handles PRD label check)
    let discovery: PrdDiscoveryResult;
    try {
      discovery = discoverPrdTarget(repo, issueNumber, cwd, prdLabel);
    } catch (err: unknown) {
      console.error(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    if (!discovery.isPrd) {
      // Should not happen since we already classified via label, but guard anyway
      console.error(
        `ERROR: Issue #${issueNumber} has the PRD label but discoverPrdTarget did not confirm it as a PRD.`,
      );
      process.exit(1);
    }

    return runPrdIssueTarget(discovery, repo, options, runArgs, cwd, {
      isDryRun,
      hasHelp,
      hasShowConfig,
      setupCommand,
      feedbackCommands,
      setupSandboxConfig,
    });
  }

  // --- Dispatch: Sub-issue ---
  if (classification.family === "subissue") {
    // Discover the parent PRD to validate and fold into its shared branch.
    const parentResult = discoverParentIssue(repo, issueNumber, cwd, prdLabel);

    // Validate sub-issue before processing
    const validation = validateSubissue(
      issueNumber,
      parentResult.hasParent ? parentResult.parentNumber : undefined,
      parentResult.parentHasPrdLabel,
    );
    if (!validation.valid) {
      console.warn(`WARNING: ${validation.message}`);
      return;
    }

    // Parent is valid — discover it as a PRD target to get sub-issues
    let discovery: PrdDiscoveryResult;
    try {
      discovery = discoverPrdTarget(
        repo,
        parentResult.parentNumber!,
        cwd,
        prdLabel,
      );
    } catch (err: unknown) {
      console.error(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    if (!discovery.isPrd) {
      console.error(
        `ERROR: Parent issue #${parentResult.parentNumber} was expected to be a PRD but was not confirmed.`,
      );
      process.exit(1);
    }

    return runPrdIssueTarget(discovery, repo, options, runArgs, cwd, {
      isDryRun,
      hasHelp,
      hasShowConfig,
      setupCommand,
      feedbackCommands,
      setupSandboxConfig,
    });
  }

  // --- Dispatch: Standalone ---
  // Validate standalone: check if it has a parent PRD (misconfiguration)
  const parentResult = discoverParentIssue(repo, issueNumber, cwd, prdLabel);
  const standaloneValidation = validateStandalone(
    issueNumber,
    parentResult.hasParent ? parentResult.parentNumber : undefined,
  );
  if (!standaloneValidation.valid) {
    console.warn(`WARNING: ${standaloneValidation.message}`);
    return;
  }

  const issueTitle = issueInfo.title;
  const issueSlug = slugify(commitTypeFromTitle(issueTitle).description);
  const branch = issueBranchName(issueTitle);

  // Ensure repo has at least one commit
  ensureRepoHasCommit(cwd);

  const baseBranch = detectBaseBranch(cwd);
  const resolvedWorktreeDir = prepareWorktree(
    cwd,
    issueSlug,
    branch,
    baseBranch,
    setupCommand,
    setupSandboxConfig,
  ); // Pull the issue into a plan file in the worktree's pipeline
  const worktreeConfig = resolveWorktreeConfig(
    resolvedWorktreeDir,
    cwd,
    runArgs,
  );
  const { backlogDir } = getRepoPipelineDirs(resolvedWorktreeDir);

  const pullResult = pullGithubIssueByNumber({
    backlogDir,
    cwd: resolvedWorktreeDir,
    issueSource: "github",
    standaloneLabel: worktreeConfig.standaloneLabel.value,
    issueRepo: worktreeConfig.issueRepo.value || repo,
    issueCommentProgress: worktreeConfig.issueCommentProgress.value === "true",
    issueNumber,
  });

  if (!pullResult.pulled) {
    console.error(
      `Failed to pull issue #${issueNumber}: ${pullResult.message}`,
    );
    process.exit(1);
  }

  console.log(pullResult.message);
  console.log("Running ralphai in worktree...");

  // Build runner options: single-target, no drain
  const activeWorktrees = listRalphaiWorktrees(cwd);
  const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);
  const shouldResume = activeWorktree !== undefined;
  const hasResumeFlag = runArgs.includes("--resume") || runArgs.includes("-r");
  const worktreeRunOptions: RalphaiOptions = {
    ...options,
    subcommand: "run",
    runTarget: undefined, // already handled
    runArgs: [
      ...(shouldResume && !hasResumeFlag ? ["--resume"] : []),
      ...runArgs,
    ],
  };

  try {
    await runRalphaiRunner(worktreeRunOptions, resolvedWorktreeDir);
  } catch {
    // runRalphaiRunner may call process.exit() on fatal errors
  }
}

// ---------------------------------------------------------------------------
// PRD issue target handler
// ---------------------------------------------------------------------------

/**
 * Handle `ralphai run <issue-number>` where the issue is a PRD.
 *
 * Creates a single `feat/<slug>` branch and worktree, then works through
 * each unchecked sub-issue sequentially. Stuck sub-issues are skipped.
 *
 * Special cases:
 * - All sub-issues already completed → report and exit
 * - No task list items → error with guidance to add sub-issues
 */
async function runPrdIssueTarget(
  discovery: PrdDiscoveryResult & { isPrd: true },
  repo: string,
  options: RalphaiOptions,
  runArgs: string[],
  cwd: string,
  flags: {
    isDryRun: boolean;
    hasHelp: boolean;
    hasShowConfig: boolean;
    setupCommand: string;
    feedbackCommands: string[];
    setupSandboxConfig?: SetupSandboxConfig;
  },
): Promise<void> {
  const { isDryRun, setupCommand, feedbackCommands, setupSandboxConfig } =
    flags;
  const { prd, subIssues, allCompleted } = discovery;
  const prdSlug = slugify(commitTypeFromTitle(prd.title).description);
  const branch = issueBranchName(prd.title);

  // --- All sub-issues already completed ---
  if (allCompleted) {
    console.log();
    console.log(
      `PRD #${prd.number} — ${prd.title}: all sub-issues already completed.`,
    );
    return;
  }

  // --- PRD with no sub-issues: error out ---
  if (subIssues.length === 0) {
    console.error(`PRD #${prd.number} has no sub-issues.`);
    console.error(`Add sub-issues to the PRD on GitHub, then retry.`);
    process.exit(1);
  }

  // --- Dry-run: preview ---
  if (isDryRun) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai dry-run — PRD target");
    console.log("========================================");
    console.log(`[dry-run] PRD: #${prd.number} — ${prd.title}`);
    console.log(`[dry-run] Branch: ${branch}`);
    console.log(`[dry-run] Worktree: ../.ralphai-worktrees/${prdSlug}/`);
    console.log(
      `[dry-run] Sub-issues: ${subIssues.map((n) => `#${n}`).join(", ")} (${subIssues.length} total)`,
    );
    console.log("[dry-run] Mode: PRD sequential (one branch, one PR)");
    console.log(
      "[dry-run] Would discover parent PRD via REST API for each sub-issue (skipped in dry-run)",
    );
    console.log(
      "[dry-run] Would query blockers via GraphQL API for each sub-issue (skipped in dry-run)",
    );
    console.log(
      "[dry-run] No plan files created, no worktrees created, no agent run executed.",
    );
    return;
  }

  // Ensure repo has at least one commit
  ensureRepoHasCommit(cwd);

  const baseBranch = detectBaseBranch(cwd);
  const resolvedWorktreeDir = prepareWorktree(
    cwd,
    prdSlug,
    branch,
    baseBranch,
    setupCommand,
    setupSandboxConfig,
  );

  const worktreeConfig = resolveWorktreeConfig(
    resolvedWorktreeDir,
    cwd,
    runArgs,
  );

  // --- PRD with unchecked sub-issues: work through sequentially ---

  // Best-effort: mark the PRD parent as in-progress before processing sub-issues.
  prdTransitionInProgress({ number: prd.number, repo }, cwd);

  console.log(
    `PRD #${prd.number} — ${prd.title}: ${subIssues.length} sub-issue(s) to work through.`,
  );
  console.log(`Sub-issues: ${subIssues.map((n) => `#${n}`).join(", ")}`);

  // --- HITL sub-issue filtering ---
  // Before processing, check each sub-issue's labels for the HITL label.
  // HITL sub-issues require human review and are skipped by the automated runner.
  const hitlLabel = worktreeConfig.issueHitlLabel.value;
  const hitlSubIssues: number[] = [];
  const eligibleSubIssues: number[] = [];
  for (const num of subIssues) {
    const labelsRaw = execQuietFn(
      `gh issue view ${num} --repo "${repo}" --json labels --jq '[.labels[].name] | join(",")'`,
      cwd,
    );
    const labels = labelsRaw ? labelsRaw.split(",") : [];
    if (labels.includes(hitlLabel)) {
      hitlSubIssues.push(num);
    } else {
      eligibleSubIssues.push(num);
    }
  }

  if (hitlSubIssues.length > 0) {
    console.log(
      `HITL (waiting on human): ${hitlSubIssues.map((n) => `#${n}`).join(", ")} — skipping (labeled "${hitlLabel}")`,
    );
  }

  if (eligibleSubIssues.length === 0) {
    console.log(
      `PRD #${prd.number} — all sub-issues are either completed, stuck, or awaiting human review. Nothing to do.`,
    );
    return;
  }

  // Build the set of HITL issue numbers for dependency checking
  const hitlIssueNumbers = new Set(hitlSubIssues);

  const stuckSubIssues: number[] = [];
  const completedSubIssues: number[] = [];
  const blockedSubIssues: BlockedSubIssue[] = [];
  const subIssueSummaries = new Map<number, string>();
  const prdLearnings: string[] = [];
  let completedCount = 0;

  for (const subIssueNumber of eligibleSubIssues) {
    console.log();
    console.log("----------------------------------------");
    console.log(
      `PRD #${prd.number} — working on sub-issue #${subIssueNumber} (${completedCount + 1}/${eligibleSubIssues.length})`,
    );
    console.log("----------------------------------------");

    // Pull the sub-issue into a plan file
    const { backlogDir } = getRepoPipelineDirs(resolvedWorktreeDir);

    const pullResult = pullGithubIssueByNumber({
      backlogDir,
      cwd: resolvedWorktreeDir,
      issueSource: "github",
      standaloneLabel: worktreeConfig.standaloneLabel.value,
      subissueLabel: worktreeConfig.subissueLabel.value,
      issueRepo: worktreeConfig.issueRepo.value || repo,
      issueCommentProgress:
        worktreeConfig.issueCommentProgress.value === "true",
      issueNumber: subIssueNumber,
    });

    if (!pullResult.pulled) {
      console.error(
        `Failed to pull sub-issue #${subIssueNumber}: ${pullResult.message}`,
      );
      stuckSubIssues.push(subIssueNumber);
      console.log(
        `Skipping sub-issue #${subIssueNumber} — continuing to next.`,
      );
      continue;
    }

    // --- Check depends-on frontmatter for HITL dependencies ---
    // If the pulled plan depends on a HITL sub-issue, skip it as blocked.
    if (pullResult.planPath && hitlIssueNumbers.size > 0) {
      const deps = extractDependsOn(pullResult.planPath);
      const hitlBlockers = findHitlBlockers(deps, hitlIssueNumbers);
      if (hitlBlockers.length > 0) {
        console.log(
          `Sub-issue #${subIssueNumber} depends on HITL sub-issue(s) ${hitlBlockers.map((n) => `#${n}`).join(", ")} — skipping.`,
        );
        blockedSubIssues.push({
          number: subIssueNumber,
          blockedBy: hitlBlockers,
        });
        continue;
      }
    }

    console.log(pullResult.message);
    console.log("Running ralphai in worktree...");

    // For sub-issues after the first, we always resume on the existing branch
    const isFirstSubIssue = completedCount === 0;
    const activeWorktrees = listRalphaiWorktrees(cwd);
    const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);
    const shouldResume = activeWorktree !== undefined || !isFirstSubIssue;
    const hasResumeFlag =
      runArgs.includes("--resume") || runArgs.includes("-r");
    // --once ensures the runner exits after completing this single sub-issue,
    // so the outer for-loop (not the runner's drain loop) controls sequencing.
    // Without this, the runner re-fetches the PRD body, finds the same
    // unchecked sub-issue, and re-pulls it.
    const hasOnceFlag = runArgs.includes("--once");
    const worktreeRunOptions: RalphaiOptions = {
      ...options,
      subcommand: "run",
      runTarget: undefined,
      runArgs: [
        ...(shouldResume && !hasResumeFlag ? ["--resume"] : []),
        ...(!hasOnceFlag ? ["--once"] : []),
        ...runArgs,
      ],
    };

    try {
      const result = await runRalphaiRunner(
        worktreeRunOptions,
        resolvedWorktreeDir,
        {
          number: prd.number,
          title: prd.title,
        },
        { skipPrCreation: true },
      );
      // Collect learnings from this sub-issue run (deduplicated)
      if (result.accumulatedLearnings) {
        for (const learning of result.accumulatedLearnings) {
          if (!prdLearnings.includes(learning)) {
            prdLearnings.push(learning);
          }
        }
      }
      if (result.stuckSlugs.length > 0) {
        // Runner returned normally but the sub-issue got stuck
        stuckSubIssues.push(subIssueNumber);
        console.log(
          `Sub-issue #${subIssueNumber} got stuck — continuing to next.`,
        );
      } else {
        completedCount++;
        completedSubIssues.push(subIssueNumber);
        if (result.lastPrSummary) {
          subIssueSummaries.set(subIssueNumber, result.lastPrSummary);
        }
      }
      // Collect learnings from this sub-issue (whether completed or stuck)
      for (const learning of result.accumulatedLearnings) {
        if (!prdLearnings.includes(learning)) {
          prdLearnings.push(learning);
        }
      }
    } catch (error) {
      // Runner may exit on stuck detection or other errors
      stuckSubIssues.push(subIssueNumber);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Sub-issue #${subIssueNumber} failed: ${errorMessage}`);
      console.log(
        `Skipping sub-issue #${subIssueNumber} — continuing to next.`,
      );
    }
  }

  // --- Summary ---
  console.log();
  const summaryLines = formatPrdHitlSummary({
    prdNumber: prd.number,
    totalSubIssues: subIssues.length,
    completedCount,
    stuckSubIssues,
    hitlSubIssues,
    blockedSubIssues,
  });
  for (const line of summaryLines) {
    console.log(line);
  }

  // --- PRD done transition ---
  // When all sub-issues completed successfully (none stuck, none HITL, none
  // blocked by HITL), mark the PRD parent as done.
  if (
    completedCount === eligibleSubIssues.length &&
    stuckSubIssues.length === 0 &&
    hitlSubIssues.length === 0 &&
    blockedSubIssues.length === 0 &&
    subIssues.length > 0
  ) {
    console.log(
      `All sub-issues of PRD #${prd.number} are done — transitioning PRD to done.`,
    );
    prdTransitionDone({ number: prd.number, repo }, cwd);
  }

  // --- Create aggregate PRD pull request ---
  if (completedCount > 0) {
    console.log();
    console.log("Creating PRD pull request...");
    const issueRepo = worktreeConfig.issueRepo.value || repo;
    const prResult = createPrdPr({
      branch,
      baseBranch,
      prd,
      completedSubIssues,
      stuckSubIssues,
      hitlSubIssues,
      blockedSubIssues,
      cwd: resolvedWorktreeDir,
      issueRepo,
      summaries: subIssueSummaries,
      learnings: prdLearnings,
    });
    console.log(prResult.message);
  } else {
    console.log();
    console.log("No sub-issues completed — skipping PR creation.");
  }
}

// ---------------------------------------------------------------------------
// Shared helpers for issue/PRD target flows
// ---------------------------------------------------------------------------

/** Resolve config for a worktree, falling back to the main repo config. */
function resolveWorktreeConfig(
  worktreeDir: string,
  mainCwd: string,
  runArgs: string[],
) {
  let cfgResult;
  try {
    cfgResult = resolveConfig({
      cwd: worktreeDir,
      envVars: process.env as Record<string, string | undefined>,
      cliArgs: runArgs,
    });
  } catch {
    cfgResult = resolveConfig({
      cwd: mainCwd,
      envVars: process.env as Record<string, string | undefined>,
      cliArgs: runArgs,
    });
  }
  return cfgResult.config;
}

/**
 * Handle `ralphai run <plan.md>` — work on a specific plan file and stop
 * after completion (single target, no drain).
 *
 * Validates the plan file exists in the backlog or in-progress directory.
 * If it doesn't exist, prints an error listing available plans.
 */
async function runPlanTarget(
  planPath: string,
  options: RalphaiOptions,
  runArgs: string[],
  cwd: string,
  flags: {
    isDryRun: boolean;
    hasHelp: boolean;
    hasShowConfig: boolean;
  },
): Promise<void> {
  const { hasHelp, hasShowConfig } = flags;

  // Pass through --help and --show-config unchanged
  if (hasHelp || hasShowConfig) {
    try {
      await runRalphaiRunner({ ...options, runArgs }, cwd);
    } catch {
      // runRalphaiRunner may call process.exit() on fatal errors
    }
    return;
  }

  // Inject --plan=<path> into runArgs so existing plan-based flow handles it
  const planFlagAlreadySet = runArgs.some((a) => a.startsWith("--plan="));
  if (!planFlagAlreadySet) {
    runArgs = [...runArgs, `--plan=${planPath}`];
  }

  // Validate the plan file exists before proceeding
  const { backlogDir, wipDir } = getRepoPipelineDirs(cwd);
  const slug = planPath.replace(/\.md$/, "");
  const backlogPlan = resolvePlanPath(backlogDir, slug);
  const wipPlan = resolvePlanPath(wipDir, slug);

  if (!backlogPlan && !wipPlan) {
    console.error(`Plan '${planPath}' not found in backlog or in-progress.`);
    const backlogPlans = listPlanFiles(backlogDir, true);
    const wipPlans = listPlanFiles(wipDir);
    const available = [...backlogPlans, ...wipPlans];
    if (available.length > 0) {
      console.error("\nAvailable plans:");
      for (const p of available) {
        console.error(`  ${p}`);
      }
    } else {
      console.error(
        "\nNo plans found. Create a plan file or configure GitHub issue integration.",
      );
    }
    process.exit(1);
  }

  // Delegate to the existing flow — runRalphaiInManagedWorktree will handle
  // the rest via --plan=<path>. Clear runTarget to avoid re-entry.
  const delegatedOptions: RalphaiOptions = {
    ...options,
    runTarget: undefined, // already handled
    runArgs,
  };

  // Re-enter the main worktree flow which handles --plan=<file>
  await runRalphaiInManagedWorktree(delegatedOptions, cwd);
}

async function runRalphaiInManagedWorktree(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  let runArgs = [...options.runArgs];
  const hasHelp = runArgs.includes("--help") || runArgs.includes("-h");
  const hasShowConfig = runArgs.includes("--show-config");
  const hasWizard = runArgs.includes("--wizard") || runArgs.includes("-w");

  const isDryRun = runArgs.includes("--dry-run") || runArgs.includes("-n");
  const planFlag = runArgs.find((a) => a.startsWith("--plan="));
  const targetPlan = planFlag ? planFlag.slice("--plan=".length) : undefined;

  // Resolve config from config/env/CLI (read-only, safe for dry-run)
  let setupCommand = "";
  let resolvedIssueSource = "none";
  let resolvedIssueLabel = DEFAULTS.standaloneLabel;
  let resolvedIssuePrdLabel = DEFAULTS.prdLabel;
  let resolvedSubissueLabel = DEFAULTS.subissueLabel;
  let resolvedIssueRepo = "";
  let resolvedIssueCommentProgress = false;
  let resolvedIssueHitlLabel = DEFAULTS.issueHitlLabel;
  let resolvedConfig: import("./config.ts").ResolvedConfig | undefined;
  try {
    const cfgResult = resolveConfig({
      cwd,
      envVars: process.env as Record<string, string | undefined>,
      cliArgs: runArgs,
    });
    resolvedConfig = cfgResult.config;
    setupCommand = cfgResult.config.setupCommand.value;
    resolvedIssueSource = cfgResult.config.issueSource.value;
    resolvedIssueLabel = cfgResult.config.standaloneLabel.value;
    resolvedIssuePrdLabel = cfgResult.config.prdLabel.value;
    resolvedSubissueLabel = cfgResult.config.subissueLabel.value;
    resolvedIssueRepo = cfgResult.config.issueRepo.value;
    resolvedIssueCommentProgress =
      cfgResult.config.issueCommentProgress.value === "true";
    resolvedIssueHitlLabel = cfgResult.config.issueHitlLabel.value;
  } catch {
    // Config resolution may fail if not yet initialised; setup will be skipped
  }

  // Parse feedback commands for the wrapper script (written to worktree root)
  const feedbackCommandsList = resolvedConfig
    ? parseFeedbackCommands(resolvedConfig.feedbackCommands.value)
    : [];

  // Build sandbox config for routing setup commands through Docker
  const setupSandboxConfig: SetupSandboxConfig | undefined = resolvedConfig
    ? {
        sandbox: resolvedConfig.sandbox.value as "none" | "docker",
        agentCommand: resolvedConfig.agentCommand.value,
        dockerConfig:
          resolvedConfig.sandbox.value === "docker"
            ? {
                dockerImage: resolvedConfig.dockerImage.value || undefined,
                dockerEnvVars: resolvedConfig.dockerEnvVars.value
                  ? resolvedConfig.dockerEnvVars.value
                      .split(",")
                      .map((s: string) => s.trim())
                      .filter(Boolean)
                  : undefined,
                dockerMounts: resolvedConfig.dockerMounts.value
                  ? resolvedConfig.dockerMounts.value
                      .split(",")
                      .map((s: string) => s.trim())
                      .filter(Boolean)
                  : undefined,
              }
            : undefined,
        // Mount the main repo's .git directory for worktree support.
        // In managed worktree mode, cwd is always the main repo root,
        // so worktrees created from it need this path mounted in Docker
        // for git operations to work inside the container.
        mainGitDir:
          resolvedConfig.sandbox.value === "docker"
            ? join(cwd, ".git")
            : undefined,
      }
    : undefined;

  // --- Interactive wizard: `--wizard` / `-w` ---
  if (hasWizard && !hasHelp) {
    if (!process.stdout.isTTY) {
      console.error("ERROR: --wizard requires an interactive terminal (TTY).");
      console.error(
        `${DIM}Run without --wizard, or use explicit flags instead:${RESET}`,
      );
      console.error(
        `  ${TEXT}ralphai run --agent-command='claude -p' --max-stuck=5${RESET}`,
      );
      process.exit(1);
    }

    if (resolvedConfig) {
      const wizardFlags = await runConfigWizard(resolvedConfig);
      if (wizardFlags === null) {
        // User cancelled — abort the run
        process.exit(0);
      }

      // Strip --wizard / -w from runArgs
      runArgs = runArgs.filter((a) => a !== "--wizard" && a !== "-w");

      // Prepend wizard flags so real CLI flags (later in array) take precedence
      // via parseCLIArgs() last-wins semantics.
      runArgs = [...wizardFlags, ...runArgs];
    }
  }

  // --- Handle explicit positional target: `ralphai run 42` or `ralphai run my-feature.md` ---
  const target = options.runTarget;

  if (target?.type === "issue") {
    return runIssueTarget(target.number, options, runArgs, cwd, {
      isDryRun,
      hasHelp,
      hasShowConfig,
      setupCommand,
      feedbackCommands: feedbackCommandsList,
      standaloneLabel: resolvedIssueLabel,
      subissueLabel: resolvedSubissueLabel,
      prdLabel: resolvedIssuePrdLabel,
      setupSandboxConfig,
    });
  }

  if (target?.type === "plan") {
    return runPlanTarget(target.path, options, runArgs, cwd, {
      isDryRun,
      hasHelp,
      hasShowConfig,
    });
  }

  // --- Parse --prd=<number> ---
  const prdFlag = runArgs.find((a) => a.startsWith("--prd="));
  let prdIssue: PrdIssue | undefined;
  if (prdFlag) {
    const prdRaw = prdFlag.slice("--prd=".length);
    const prdNum = parseInt(prdRaw, 10);
    if (isNaN(prdNum) || String(prdNum) !== prdRaw) {
      console.error(
        `ERROR: --prd requires a numeric issue number, got '${prdRaw}'`,
      );
      process.exit(1);
    }

    // For dry-run, help, and show-config we still need to resolve PRD so the
    // runner can display derived branch info. We resolve it here (read-only)
    // before the early exit path.
    if (!hasHelp && !hasShowConfig) {
      // Validate early (before worktree creation) — both dry-run and real runs
      validateRunArgs(runArgs);

      if (isGitWorktree(cwd)) {
        console.error(`'ralphai run' must be run from the main repository.`);
        console.error(
          "You are inside a worktree. Run this command from the main repo.",
        );
        process.exit(1);
      }

      if (!existsSync(getConfigFilePath(cwd))) {
        console.error(
          `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
        );
        process.exit(1);
      }

      // Resolve PRD: ensure label exists, fetch issue, validate label
      const repo = detectIssueRepo(cwd);
      if (!repo) {
        console.error(
          "ERROR: Could not detect GitHub repo from git remote. " +
            "Set issue-repo in config or ensure a remote is configured.",
        );
        process.exit(1);
      }

      try {
        prdIssue = fetchPrdIssueByNumber(
          repo,
          prdNum,
          cwd,
          resolvedIssuePrdLabel,
        );
      } catch (err: unknown) {
        console.error(
          `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      const prdSlug = slugify(commitTypeFromTitle(prdIssue.title).description);
      const branch = issueBranchName(prdIssue.title);

      if (isDryRun) {
        console.log();
        console.log("========================================");
        console.log("  Ralphai dry-run — PRD preview");
        console.log("========================================");
        console.log(`[dry-run] PRD: #${prdIssue.number} — ${prdIssue.title}`);
        console.log(`[dry-run] Branch: ${branch}`);
        console.log(`[dry-run] Worktree: ../.ralphai-worktrees/${prdSlug}/`);
        console.log("[dry-run] Mode: drain (PRD sub-issues)");
        console.log(
          "[dry-run] Would fetch sub-issues via REST API (skipped in dry-run)",
        );
        console.log(
          "[dry-run] Would discover parent PRD via REST API for each sub-issue (skipped in dry-run)",
        );
        console.log(
          "[dry-run] Would query blockers via GraphQL API for each sub-issue (skipped in dry-run)",
        );
        console.log(
          "[dry-run] No plan files created, no worktrees created, no agent run executed.",
        );
        return;
      }

      // --- Real PRD run: create worktree with PRD-derived branch ---
      ensureRepoHasCommit(cwd);
      const baseBranch = detectBaseBranch(cwd);
      const activeWorktrees = listRalphaiWorktrees(cwd);
      const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);
      const resolvedWorktreeDir = prepareWorktree(
        cwd,
        prdSlug,
        branch,
        baseBranch,
        setupCommand,
        setupSandboxConfig,
      );

      // NOTE: The feedback wrapper script is written by the runner to the
      // WIP slug directory (pipeline state), not the worktree. No wrapper
      // write needed here.

      console.log("Running ralphai in worktree...");
      const shouldResume = activeWorktree !== undefined;
      const hasResumeFlag =
        runArgs.includes("--resume") || runArgs.includes("-r");
      const worktreeRunOptions: RalphaiOptions = {
        ...options,
        subcommand: "run",
        runArgs: [
          ...(shouldResume && !hasResumeFlag ? ["--resume"] : []),
          ...runArgs,
        ],
      };

      try {
        await runRalphaiRunner(
          worktreeRunOptions,
          resolvedWorktreeDir,
          prdIssue,
        );
      } catch {
        // runRalphaiRunner may call process.exit() on fatal errors
      }
      return;
    }
  }

  if (hasHelp || hasShowConfig || isDryRun) {
    try {
      await runRalphaiRunner({ ...options, runArgs }, cwd);
    } catch {
      // runRalphaiRunner may call process.exit() on fatal errors
    }
    return;
  }

  validateRunArgs(runArgs);

  if (isGitWorktree(cwd)) {
    console.error(`'ralphai run' must be run from the main repository.`);
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  ensureRepoHasCommit(cwd);

  const hasOnce = runArgs.includes("--once");
  const baseBranch = detectBaseBranch(cwd);

  // Build GitHub fallback options so selectPlanForWorktree can pull an issue
  // when the local backlog is empty and issueSource is "github".
  const githubFallback: GitHubFallbackOptions | undefined =
    resolvedIssueSource === "github"
      ? {
          issueSource: resolvedIssueSource,
          pullFn: () => {
            const { backlogDir } = getRepoPipelineDirs(cwd);
            const pullOpts: PullIssueOptions = {
              backlogDir,
              cwd,
              issueSource: resolvedIssueSource,
              standaloneLabel: resolvedIssueLabel,
              subissueLabel: resolvedSubissueLabel,
              issueRepo: resolvedIssueRepo,
              issueCommentProgress: resolvedIssueCommentProgress,
              issuePrdLabel: resolvedIssuePrdLabel,
              issueHitlLabel: resolvedIssueHitlLabel,
            };
            // Priority chain: try PRD sub-issues first, then regular issues
            const prdResult = pullPrdSubIssue(pullOpts);
            if (prdResult.pulled) return prdResult;
            return pullGithubIssues(pullOpts);
          },
        }
      : undefined;

  // --- Drain loop: each plan gets its own branch and worktree ---
  // This mirrors how runPrdIssueTarget sequences sub-issues: the outer loop
  // controls plan selection and worktree lifecycle, while the runner processes
  // a single plan per invocation (--once).
  let plansProcessed = 0;

  while (true) {
    const activeWorktrees = listRalphaiWorktrees(cwd);

    const plan = selectPlanForWorktree(
      cwd,
      targetPlan,
      activeWorktrees,
      githubFallback,
    );
    if (!plan) {
      if (plansProcessed === 0) process.exit(1);
      break;
    }

    // --- PRD sub-issue detection: if the plan has prd: N frontmatter,
    // delegate to the unified PRD flow instead of standalone processing. ---
    const { backlogDir: drainBacklog, wipDir: drainWip } =
      getRepoPipelineDirs(cwd);
    const planDir = plan.source === "backlog" ? drainBacklog : drainWip;
    const planFullPath = resolvePlanPath(planDir, plan.slug);

    if (planFullPath) {
      const fm = extractIssueFrontmatter(planFullPath);
      if (fm.prd !== undefined) {
        const repo = detectIssueRepo(cwd, resolvedIssueRepo);
        if (!repo) {
          console.error(
            `Plan '${plan.planFile}' has prd: ${fm.prd} but could not detect GitHub repo.`,
          );
          console.error(
            "Set issue-repo in config or ensure a GitHub remote is configured.",
          );
          // Cannot route through PRD flow without a repo — stop the drain loop.
          // The plan stays in the backlog for manual intervention.
          if (plansProcessed === 0) process.exit(1);
          break;
        }

        let prdDiscovery: PrdDiscoveryResult;
        try {
          prdDiscovery = discoverPrdTarget(
            repo,
            fm.prd,
            cwd,
            resolvedIssuePrdLabel,
          );
        } catch (err: unknown) {
          console.error(
            `Failed to discover PRD #${fm.prd} for plan '${plan.planFile}': ${err instanceof Error ? err.message : String(err)}`,
          );
          // PRD discovery failed — stop the drain loop.
          // The plan stays in the backlog for retry.
          if (plansProcessed === 0) process.exit(1);
          break;
        }

        if (prdDiscovery.isPrd) {
          // Delegate to the unified PRD flow (single feat/ branch, aggregate PR)
          await runPrdIssueTarget(prdDiscovery, repo, options, runArgs, cwd, {
            isDryRun: false,
            hasHelp: false,
            hasShowConfig: false,
            setupCommand,
            feedbackCommands: feedbackCommandsList,
            setupSandboxConfig,
          });
          // runPrdIssueTarget handles all sub-issues and PR creation — we're done
          break;
        }

        // isPrd: false — PRD label was removed; fall through to standalone processing
        console.log(
          `Plan '${plan.planFile}' has prd: ${fm.prd} but issue #${fm.prd} is no longer a PRD. Processing as standalone.`,
        );
      }
    }

    const planDesc = planFullPath
      ? getPlanDescription(planFullPath)
      : plan.planFile;
    const branch = issueBranchName(planDesc);
    const resolvedWorktreeDir = prepareWorktree(
      cwd,
      plan.slug,
      branch,
      baseBranch,
      setupCommand,
      setupSandboxConfig,
    );

    console.log("Running ralphai in worktree...");
    const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);
    const shouldResume =
      plan.source === "in-progress" || activeWorktree !== undefined;
    const hasResumeFlag =
      runArgs.includes("--resume") || runArgs.includes("-r");
    const hasOnceFlag = runArgs.includes("--once");
    const worktreeRunOptions: RalphaiOptions = {
      ...options,
      subcommand: "run",
      runArgs: [
        ...(shouldResume && !hasResumeFlag ? ["--resume"] : []),
        ...(!hasOnceFlag ? ["--once"] : []),
        ...runArgs,
      ],
    };

    try {
      await runRalphaiRunner(worktreeRunOptions, resolvedWorktreeDir);
    } catch {
      // runRalphaiRunner may call process.exit() on fatal errors
    }

    plansProcessed++;

    // --- Clean up worktree between plans so the next one starts fresh ---
    // Skip cleanup on --once (the single worktree may still be useful) and
    // when this was a pre-existing worktree we reused.
    if (!hasOnce && !activeWorktree) {
      try {
        execSync(`git worktree remove --force "${resolvedWorktreeDir}"`, {
          cwd,
          stdio: "pipe",
        });
      } catch {
        // Best-effort cleanup; the worktree may have already been removed
        // or the directory may not exist.
      }
    }

    // --- --once: stop after a single plan ---
    if (hasOnce) {
      break;
    }

    // Loop back to select the next plan (each gets a fresh branch/worktree)
  }
}

async function runRalphaiRunner(
  options: RalphaiOptions,
  cwd: string,
  prdIssue?: PrdIssue,
  runnerFlags?: { skipPrCreation?: boolean },
): Promise<RunnerResult> {
  const worktreeInfo = resolveWorktreeInfo(cwd);
  const runArgs = options.runArgs;

  // --- Handle --help ---
  if (runArgs.includes("--help") || runArgs.includes("-h")) {
    showRunHelp();
    return { stuckSlugs: [], accumulatedLearnings: [] };
  }

  // --- Reject unrecognized flags ---
  validateRunArgs(runArgs);

  // --- Parse flags ---
  const isDryRun = runArgs.includes("--dry-run") || runArgs.includes("-n");
  let hasAllowDirty = runArgs.includes("--allow-dirty");
  const hasResume = runArgs.includes("--resume") || runArgs.includes("-r");
  const hasOnce = runArgs.includes("--once");
  const hasShowConfig = runArgs.includes("--show-config");
  const planFlag = runArgs.find((a) => a.startsWith("--plan="));
  const targetPlan = planFlag ? planFlag.slice("--plan=".length) : undefined;

  // --- Resolve config: defaults -> file -> env -> CLI ---
  const envVars = process.env as Record<string, string | undefined>;
  let config;
  let configFilePath: string;
  try {
    const result = resolveConfig({
      cwd,
      envVars,
      cliArgs: runArgs,
    });
    for (const w of result.warnings) {
      console.error(w);
    }
    config = result.config;
    configFilePath = result.configFilePath;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  // --- Handle --show-config ---
  if (hasShowConfig) {
    const { rawFlags } = parseCLIArgs(runArgs);
    const worktree = worktreeInfo.isWorktree
      ? { isWorktree: true, mainWorktree: worktreeInfo.mainWorktree }
      : undefined;
    const text = formatShowConfig({
      config,
      configFilePath,
      configFileExists: existsSync(configFilePath),
      envVars,
      rawFlags,
      worktree,
      workspaces: config.workspaces.value,
    });
    console.log(text);
    return { stuckSlugs: [], accumulatedLearnings: [] };
  }

  // Check that ralphai has been initialized (global config exists).
  if (!existsSync(configFilePath) && !isDryRun) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Check receipt files for cross-source conflicts before running.
  if (!isDryRun) {
    const { wipDir } = getRepoPipelineDirs(cwd);
    if (!checkReceiptSource(wipDir, worktreeInfo.isWorktree)) {
      process.exit(1);
    }
  }

  // Best-effort: ensure all issue-tracking labels exist. Non-throwing so
  // upgrading users don't need to re-run `ralphai init`. Skipped in dry-run.
  if (!isDryRun && config.issueSource.value === "github") {
    try {
      ensureGitHubLabels(cwd, {
        standalone: config.standaloneLabel.value,
        subissue: config.subissueLabel.value,
        prd: config.prdLabel.value,
      });
    } catch {
      // Intentionally swallowed — label creation is best-effort.
    }
  }

  // --- Pre-flight: interactive dirty-state check ---
  if (!isDryRun && !hasAllowDirty && !hasResume) {
    let treeDirty = false;
    try {
      // Check for dirty state, excluding .ralphai (gitignored dir / worktree
      // symlink). Config now lives in global state, so no repo-local exclusion
      // is needed.
      // Note: pathspec excludes must not be single-quoted; cmd.exe on Windows
      // passes the literal quotes to git, breaking the exclude pattern.
      execSync("git diff --quiet HEAD -- :!.ralphai", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      execSync("git diff --cached --quiet -- :!.ralphai", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const untracked = execSync(
        "git ls-files --others --exclude-standard -- :!.ralphai",
        { cwd, encoding: "utf-8" },
      ).trim();
      if (untracked.length > 0) {
        treeDirty = true;
      }
    } catch {
      treeDirty = true;
    }

    if (treeDirty && process.stdin.isTTY) {
      const proceed = await clack.confirm({
        message: "Working tree has uncommitted changes. Continue anyway?",
        initialValue: false,
      });
      if (clack.isCancel(proceed) || !proceed) {
        console.log(
          `${DIM}Tip: commit your changes first, or re-run with --allow-dirty to skip this check.${RESET}`,
        );
        process.exit(1);
      }
      hasAllowDirty = true;
    }
  }

  // --- Build runner options and invoke the TypeScript runner directly ---
  const runnerOpts: RunnerOptions = {
    config,
    cwd,
    isWorktree: worktreeInfo.isWorktree,
    mainWorktree: worktreeInfo.mainWorktree,
    dryRun: isDryRun,
    resume: hasResume,
    allowDirty: hasAllowDirty,
    once: hasOnce,
    plan: targetPlan,
    prd: prdIssue,
    skipPrCreation: runnerFlags?.skipPrCreation,
  };

  return await runRunner(runnerOpts);
}

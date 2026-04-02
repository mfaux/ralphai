import { execSync } from "child_process";
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
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";
import { runSelfUpdate } from "./self-update.ts";
import {
  listPlanFolders,
  planPathForSlug,
  listPlanSlugs,
  listPlanFiles,
  resolvePlanPath,
  planExistsForSlug,
  countCompletedTasks,
} from "./plan-detection.ts";
import {
  parseReceipt,
  checkReceiptSource,
  findPlansByBranch,
} from "./receipt.ts";
import {
  getRepoPipelineDirs,
  resolveRepoByNameOrPath,
} from "./global-state.ts";
import {
  detectFeedbackCommands,
  detectWorkspaces,
  detectProject,
  detectSetupCommand,
} from "./project-detection.ts";
import type { DetectedProject, WorkspacePackage } from "./project-detection.ts";
import { runRunner, type RunnerOptions } from "./runner.ts";
import {
  resolveConfig,
  parseCLIArgs,
  ConfigError,
  getConfigFilePath,
  writeConfigFile,
} from "./config.ts";
import { formatShowConfig } from "./show-config.ts";
import { runUninstall, showUninstallHelp } from "./uninstall.ts";
import { runRepos, showReposHelp } from "./repos.ts";
import { runConfigCommand, showConfigCommandHelp } from "./config-cmd.ts";
import { runRalphaiStop, showStopHelp } from "./stop.ts";
import { runClean, showCleanHelp } from "./clean.ts";
import { handleRemovedCommand, handleRemovedRunFlags } from "./removed.ts";
import { gatherPipelineState } from "./pipeline-state.ts";
import {
  AGENTS_MD_HEADER,
  AGENTS_MD_RALPHAI_SECTION,
} from "./agents-md-template.ts";
import {
  detectIssueRepo,
  ensurePrdLabel,
  fetchPrdIssueByNumber,
  fetchIssueTitleByNumber,
  prdBranchName,
  pullGithubIssueByNumber,
  pullGithubIssues,
  pullPrdSubIssue,
  slugify,
} from "./issues.ts";
import type { PrdIssue, PullIssueOptions, PullIssueResult } from "./issues.ts";
import { discoverPrdTarget } from "./prd-discovery.ts";
import type { PrdDiscoveryResult } from "./prd-discovery.ts";
import { detectRunTarget, type RunTarget } from "./target-detection.ts";
import { restoreIssueLabels } from "./reset-labels.ts";
import { createPrdPr } from "./pr-lifecycle.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RalphaiSubcommand =
  | "init"
  | "update"
  | "run"
  | "prd"
  | "uninstall"
  | "worktree"
  | "status"
  | "stop"
  | "reset"
  | "purge"
  | "clean"
  | "doctor"
  | "backlog-dir"
  | "repos"
  | "check"
  | "config"
  | "seed"
  | "teardown";

type WorktreeSubcommand = "run" | "list" | "clean";

interface WorktreeOptions {
  subcommand: WorktreeSubcommand;
  plan?: string; // --plan=<file>
  dir?: string; // --dir=<path>
  runArgs: string[]; // passthrough args for the runner (--agent-command, etc.)
}

interface RalphaiOptions {
  subcommand: RalphaiSubcommand | undefined;
  yes: boolean;
  force: boolean;
  clean: boolean;
  all: boolean;
  global: boolean; // --global (for `uninstall`)
  worktrees: boolean; // --worktrees (for `clean`)
  archive: boolean; // --archive (for `clean`)
  agentCommand?: string;
  targetDir?: string;
  repo?: string; // --repo=<name-or-path>
  capabilities: string[]; // --capability=<name> (repeatable, for `check`)
  configKey?: string; // positional arg for `config` subcommand
  checkCapabilities: string[]; // --check=<name> (repeatable, for `config --check`)
  prdNumber?: string; // positional arg for `prd` subcommand
  once: boolean; // --once (for status auto-watch)
  stopSlug?: string; // positional arg for `stop` subcommand
  runTarget?: RunTarget; // positional target for `run` (issue number, plan path, or auto)
  runArgs: string[];
  worktreeOptions?: WorktreeOptions;
  unknownFlags: string[];
}

interface WizardAnswers {
  agentCommand: string;
  setupCommand: string;
  baseBranch: string;
  feedbackCommands: string;
  autoCommit?: boolean;
  issueSource: "none" | "github";
  updateAgentsMd?: boolean;
  createSamplePlan?: boolean;
  workspaces?: Record<string, { feedbackCommands: string[] }>;
}

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
// Sample plan content
// ---------------------------------------------------------------------------

/** Content for the hello-world sample plan. Used by `init` and `seed`. */
const HELLO_WORLD_PLAN = loadSamplePlan("hello-world.md");

const HELLO_WORLD_SLUG = "hello-world";

function loadSamplePlan(filename: string): string {
  const candidates = [
    new URL(`./sample-plans/${filename}`, import.meta.url),
    new URL(`../src/sample-plans/${filename}`, import.meta.url),
  ];

  for (const url of candidates) {
    try {
      return readFileSync(url, "utf-8");
    } catch {
      continue;
    }
  }

  throw new Error(`Missing sample plan: ${filename}`);
}

// ---------------------------------------------------------------------------
// Options parsing
// ---------------------------------------------------------------------------

const SUBCOMMANDS = new Set<RalphaiSubcommand>([
  "init",
  "update",
  "run",
  "prd",
  "uninstall",
  "worktree",
  "status",
  "stop",
  "reset",
  "purge",
  "clean",
  "doctor",
  "backlog-dir",
  "repos",
  "check",
  "config",
  "seed", // hidden — not listed in showRalphaiHelp()
  "teardown", // removed — prints migration guidance
]);

function parseRalphaiOptions(args: string[]): RalphaiOptions {
  let subcommand: RalphaiSubcommand | undefined;
  let yes = false;
  let force = false;
  let clean = false;
  let all = false;
  let global = false;
  let once = false;
  let worktrees = false;
  let archive = false;
  let agentCommand: string | undefined;
  let targetDir: string | undefined;
  let repo: string | undefined;
  let prdNumber: string | undefined;
  let runTarget: RunTarget | undefined;
  const capabilities: string[] = [];
  const checkCapabilities: string[] = [];
  let configKey: string | undefined;
  const runArgs: string[] = [];
  let worktreeOptions: WorktreeOptions | undefined;
  const unknownFlags: string[] = [];

  let collectingRunArgs = false;
  let collectingConfigArgs = false;
  let expectingPrdNumber = false;
  let expectingRunTarget = false;
  let expectingStopSlug = false;
  let stopSlug: string | undefined;

  for (const arg of args) {
    // After `run`/`prd` subcommand or `--`, collect remaining args for the runner
    if (collectingRunArgs) {
      if (arg === "--") continue; // skip bare `--` separator (still supported)
      // For `prd`, the first non-flag positional arg is the issue number
      if (expectingPrdNumber && !arg.startsWith("-")) {
        prdNumber = arg;
        expectingPrdNumber = false;
        continue;
      }
      // For `run`, the first non-flag positional arg is the target
      if (expectingRunTarget && !arg.startsWith("-")) {
        try {
          runTarget = detectRunTarget(arg);
        } catch (err: unknown) {
          console.error(
            err instanceof Error ? err.message : `Invalid run target: ${arg}`,
          );
          process.exit(1);
        }
        expectingRunTarget = false;
        continue;
      }
      runArgs.push(arg);
      continue;
    }

    // After `config` subcommand, collect config-specific args
    if (collectingConfigArgs) {
      if (arg.startsWith("--check=")) {
        checkCapabilities.push(arg.slice("--check=".length));
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        // Let the main dispatcher handle --help
        continue;
      }
      if (!arg.startsWith("-") && !configKey) {
        configKey = arg;
        continue;
      }
      // Anything else is an unknown flag (will be caught by strict parsing)
      unknownFlags.push(arg);
      continue;
    }

    // For `stop`, the first non-flag positional after the subcommand is the slug
    if (expectingStopSlug && !arg.startsWith("-")) {
      stopSlug = arg;
      expectingStopSlug = false;
      continue;
    }

    if (arg === "--") {
      collectingRunArgs = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--clean") {
      clean = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--global") {
      global = true;
    } else if (arg === "--worktrees") {
      worktrees = true;
    } else if (arg === "--archive") {
      archive = true;
    } else if (arg === "--once") {
      once = true;
    } else if (arg === "--dry-run" || arg === "-n") {
      // Handled by specific subcommands (run, stop) — skip here
    } else if (arg === "--help" || arg === "-h") {
      // Handled by runRalphai() dispatcher — skip here
    } else if (arg === "--no-color") {
      // Handled by utils.ts at module load — skip here
    } else if (arg.startsWith("--agent-command=")) {
      agentCommand = arg.slice("--agent-command=".length);
    } else if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    } else if (arg.startsWith("--capability=")) {
      capabilities.push(arg.slice("--capability=".length));
    } else if (!arg.startsWith("-")) {
      // First non-flag arg is the subcommand; second is targetDir
      if (!subcommand && SUBCOMMANDS.has(arg as RalphaiSubcommand)) {
        subcommand = arg as RalphaiSubcommand;
        // For `run`, everything after is forwarded to the runner
        if (subcommand === "run") {
          collectingRunArgs = true;
          expectingRunTarget = true;
        }
        // For `prd`, next positional is the issue number, rest are runArgs
        if (subcommand === "prd") {
          collectingRunArgs = true;
          expectingPrdNumber = true;
        }
        // For `stop`, next positional is the plan slug
        if (subcommand === "stop") {
          expectingStopSlug = true;
        }
        // For `worktree`, parse worktree-specific args from the rest
        if (subcommand === "worktree") {
          worktreeOptions = parseWorktreeArgs(
            args.slice(args.indexOf(arg) + 1),
          );
          break; // worktree parser consumed remaining args
        }
        // For `config`, collect config-specific args from the rest
        if (subcommand === "config") {
          collectingConfigArgs = true;
        }
      } else {
        targetDir = arg;
      }
    } else {
      // Flag not recognized — track it
      unknownFlags.push(arg);
    }
  }

  return {
    subcommand,
    yes,
    force,
    clean,
    all,
    global,
    worktrees,
    archive,
    once,
    agentCommand,
    targetDir,
    repo,
    capabilities,
    configKey,
    checkCapabilities,
    prdNumber,
    stopSlug,
    runTarget,
    runArgs,
    worktreeOptions,
    unknownFlags,
  };
}

const WORKTREE_SUBCOMMANDS = new Set<WorktreeSubcommand>(["list", "clean"]);

function parseWorktreeArgs(args: string[]): WorktreeOptions {
  let wtSubcommand: WorktreeSubcommand = "run";
  let plan: string | undefined;
  let dir: string | undefined;
  const wtRunArgs: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--plan=")) {
      plan = arg.slice("--plan=".length);
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (
      !arg.startsWith("-") &&
      wtSubcommand === "run" &&
      WORKTREE_SUBCOMMANDS.has(arg as WorktreeSubcommand)
    ) {
      wtSubcommand = arg as WorktreeSubcommand;
    } else {
      // Everything else passes through to the runner
      wtRunArgs.push(arg);
    }
  }

  return { subcommand: wtSubcommand, plan, dir, runArgs: wtRunArgs };
}

// ---------------------------------------------------------------------------
// Git detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `dir` is inside a git repository.
 */
function isInsideGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Extract a trimmed stderr string from an execSync error, if available. */
function extractExecStderr(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "stderr" in err &&
    (err as { stderr: unknown }).stderr
  ) {
    const raw = (err as { stderr: Buffer | string }).stderr;
    const text = typeof raw === "string" ? raw : raw.toString("utf-8");
    return text.trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Base branch detection
// ---------------------------------------------------------------------------

function detectBaseBranch(cwd?: string): string {
  // 1. Remote default branch (most reliable when a remote exists)
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // no remote or origin/HEAD not set
  }

  // 2. Well-known default branch names
  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git show-ref --verify refs/heads/${candidate}`, {
        stdio: "ignore",
        ...(cwd ? { cwd } : {}),
      });
      return candidate;
    } catch {
      // not found, try next
    }
  }

  // 3. Current branch (covers fresh repos with non-standard default names)
  try {
    const current = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
    }).trim();
    if (current) return current;
  } catch {
    // detached HEAD or other edge case
  }

  // 4. Last resort — use HEAD directly so git commands still have a valid ref
  return "HEAD";
}

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

  let autoCommit = false;

  // 6. GitHub Issues integration
  const enableIssues = await clack.confirm({
    message: "Enable GitHub Issues integration?",
    initialValue: false,
  });

  if (clack.isCancel(enableIssues)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  if (enableIssues) {
    clack.note(
      "When Ralphai's backlog is empty, it will automatically pull the oldest\n" +
        'open issue labeled "ralphai" and convert it to a plan.',
      "GitHub Issues",
    );
  }

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
    autoCommit,
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
  intake: string;
  inProgress: string;
  done: string;
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

/** The four label definitions with their descriptions and colors. */
function labelDefs(names: LabelNames) {
  return [
    {
      name: names.intake,
      description: "Ralphai picks up this issue",
      color: "7057ff",
    },
    {
      name: names.inProgress,
      description: "Ralphai is working on this issue",
      color: "fbca04",
    },
    {
      name: names.done,
      description: "Ralphai finished this issue",
      color: "0e8a16",
    },
    {
      name: "ralphai-prd",
      description: "Ralphai PRD — groups sub-issues for drain runs",
      color: "1d76db",
    },
  ];
}

/**
 * Create issue-tracking labels on the GitHub repo. Uses `gh label create
 * --force` so it is idempotent. Never throws — label creation is best-effort.
 *
 * Creates four labels: intake, in-progress, done, and prd. The first three use
 * the configured label names; the prd label is always `ralphai-prd`.
 */
function ensureGitHubLabels(cwd: string, names: LabelNames): LabelResult {
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
  // Generate config (JSON format) — all 14 keys with explicit defaults
  const feedbackCommands = answers.feedbackCommands
    ? answers.feedbackCommands
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
    baseBranch: answers.baseBranch,
    setupCommand: answers.setupCommand ?? "",
    autoCommit: answers.autoCommit ?? false,
    iterationTimeout: 0,
    issueSource: answers.issueSource ?? "none",
    issueLabel: "ralphai",
    issueInProgressLabel: "ralphai:in-progress",
    issueDoneLabel: "ralphai:done",
    issueRepo: "",
    issueCommentProgress: true,
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
    intake: configObj.issueLabel as string,
    inProgress: configObj.issueInProgressLabel as string,
    done: configObj.issueDoneLabel as string,
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
      const allLabels = labelDefs(initLabelNames).map((l) => `"${l.name}"`);
      const labelList =
        allLabels.slice(0, -1).join(", ") + ", and " + allLabels.at(-1);
      console.log(
        `  GitHub labels              ${DIM}Created ${labelList} labels${RESET}`,
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
      `${DIM}Label a GitHub issue with "ralphai" and Ralphai will pick it up automatically.${RESET}`,
    );
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
  const inProgressDir = wipDir;

  if (!existsSync(inProgressDir)) {
    console.log("Nothing to reset — no in-progress directory.");
    return;
  }

  const planSlugs = listPlanFolders(inProgressDir);
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
  }
  if (planFiles.length > 0) {
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

  // Load config to get label names for GitHub issue restoration.
  // Best-effort: if config resolution fails we skip label restoration.
  let issueLabel = "";
  let issueInProgressLabel = "";
  let issueRepo = "";
  try {
    const cfgResult = resolveConfig({
      cwd,
      envVars: process.env,
      cliArgs: [],
    });
    issueLabel = cfgResult.config.issueLabel.value;
    issueInProgressLabel = cfgResult.config.issueInProgressLabel.value;
    issueRepo = cfgResult.config.issueRepo.value;
  } catch {
    // Config resolution failure is not critical — skip label restoration.
  }

  // 1. Extract plan files from in-progress slug-folders back to backlog as flat files
  for (const slug of planSlugs) {
    const src = join(inProgressDir, slug);
    const planFile = join(src, `${slug}.md`);
    const dest = join(backlogDir, `${slug}.md`);
    mkdirSync(backlogDir, { recursive: true });

    // Restore GitHub issue labels before moving the file (needs frontmatter).
    if (issueLabel && issueInProgressLabel && existsSync(planFile)) {
      const labelResult = restoreIssueLabels({
        planPath: planFile,
        issueLabel,
        issueInProgressLabel,
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
  }
  if (planFiles.length > 0) {
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
      const issueLabel = cfgResult.config.issueLabel.value;
      const issueInProgressLabel = cfgResult.config.issueInProgressLabel.value;
      const issueRepo = cfgResult.config.issueRepo.value;
      if (issueLabel && issueInProgressLabel) {
        const labelResult = restoreIssueLabels({
          planPath: planFile,
          issueLabel,
          issueInProgressLabel,
          issueRepo,
          cwd,
        });
        if (labelResult.restored) {
          console.log(`  ${DIM}${labelResult.message}${RESET}`);
        }
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

async function runRalphaiPurge(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const { archiveDir: outDir } = getRepoPipelineDirs(cwd);

  if (!existsSync(outDir)) {
    console.log("Nothing to purge — no out/ directory.");
    return;
  }

  const entries = readdirSync(outDir, { withFileTypes: true });
  const planDirs = entries.filter((entry) => entry.isDirectory());
  if (planDirs.length === 0) {
    console.log("Nothing to purge — out/ is already empty.");
    return;
  }

  const planFiles = planDirs.filter((entry) => {
    const planPath = planPathForSlug(outDir, entry.name);
    return existsSync(planPath);
  }).length;
  const progressFiles = planDirs.filter((entry) =>
    existsSync(join(outDir, entry.name, "progress.md")),
  ).length;
  const receiptFiles = planDirs.filter((entry) =>
    existsSync(join(outDir, entry.name, "receipt.txt")),
  ).length;

  // Show what will be deleted
  console.log();
  console.log(
    `${TEXT}The following archived artifacts will be deleted:${RESET}`,
  );
  console.log();
  if (planFiles > 0) {
    console.log(
      `  ${TEXT}Plans${RESET}       ${DIM}${planFiles} archived plan${planFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
  if (progressFiles > 0) {
    console.log(
      `  ${TEXT}Progress${RESET}    ${DIM}${progressFiles} progress file${progressFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
  if (receiptFiles > 0) {
    console.log(
      `  ${TEXT}Receipts${RESET}    ${DIM}${receiptFiles} receipt${receiptFiles !== 1 ? "s" : ""}${RESET}`,
    );
  }
  console.log();

  // Confirm unless --yes
  if (!options.yes) {
    clack.intro("Ralphai Purge");
    const confirmed = await clack.confirm({
      message:
        "Delete all archived artifacts from pipeline/out/? This cannot be undone.",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Purge cancelled.");
      return;
    }
  }

  // Delete all plan folders in out/
  for (const planDir of planDirs) {
    rmSync(join(outDir, planDir.name), { recursive: true, force: true });
  }

  // Summary
  console.log(`${TEXT}Purged.${RESET}`);
  console.log();
  console.log(`${DIM}Deleted:${RESET}`);
  if (planFiles > 0) {
    console.log(`  ${planFiles} archived plan${planFiles !== 1 ? "s" : ""}`);
  }
  if (progressFiles > 0) {
    console.log(
      `  ${progressFiles} progress file${progressFiles !== 1 ? "s" : ""}`,
    );
  }
  if (receiptFiles > 0) {
    console.log(`  ${receiptFiles} receipt${receiptFiles !== 1 ? "s" : ""}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------

function showRalphaiHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai <command> [options]`);
  console.log();
  console.log(`${TEXT}Core${RESET}`);
  console.log(
    `  ${TEXT}run${RESET}         ${DIM}Run a plan in an isolated worktree (or 'run <issue>' / 'run <plan.md>')${RESET}`,
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
  const GIT_REQUIRED_COMMANDS = new Set<RalphaiSubcommand>(["run", "init"]);
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

  // --- Removed command guidance ---
  // Intercept commands that have been removed before they reach the dispatcher.
  // This prints an actionable migration message and exits 1.
  if (options.subcommand) {
    handleRemovedCommand(options.subcommand, {
      prdNumber: options.prdNumber,
    });
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
    default:
      showRalphaiHelp();
      break;
  }
}

// ---------------------------------------------------------------------------
// Worktree detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `dir` is inside a git worktree (as opposed to the main
 * working tree). Uses the fact that in a worktree, `--git-common-dir` points
 * to the main repo's `.git` while `--git-dir` points to
 * `.git/worktrees/<name>`.
 */
function isGitWorktree(dir: string): boolean {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    // In a worktree, --git-common-dir points to the main repo's .git
    // while --git-dir points to .git/worktrees/<name>
    return commonDir !== gitDir;
  } catch {
    return false;
  }
}

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
    const detectedSetupStr = detectSetupCommand(cwd);

    answers = {
      agentCommand,
      setupCommand: detectedSetupStr,
      baseBranch: detectBaseBranch(cwd),
      feedbackCommands: detectedFeedbackStr,
      autoCommit: false,
      issueSource: "none",
      updateAgentsMd: !agentsMdHasSection,
      createSamplePlan: true,
    };

    // Print detection summary so users can verify auto-detected values
    const feedbackDisplay = answers.feedbackCommands.trim() || "(none)";
    const setupDisplay = answers.setupCommand.trim() || "(none)";
    console.log(`${DIM}Detected:${RESET}`);
    console.log(
      `  ${DIM}Agent:${RESET}     ${TEXT}${answers.agentCommand}${RESET}`,
    );
    console.log(
      `  ${DIM}Branch:${RESET}    ${TEXT}${answers.baseBranch}${RESET}`,
    );
    console.log(`  ${DIM}Feedback:${RESET}  ${TEXT}${feedbackDisplay}${RESET}`);
    console.log(`  ${DIM}Setup:${RESET}     ${TEXT}${setupDisplay}${RESET}`);
    console.log(
      `  ${DIM}Project:${RESET}   ${TEXT}${detectedProject?.label ?? "(none)"}${RESET}`,
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
// Worktree subcommand
// ---------------------------------------------------------------------------

export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

export interface SelectedWorktreePlan {
  planFile: string;
  slug: string;
  source: "backlog" | "in-progress";
}

/** Options for attempting a GitHub issue pull when the local backlog is empty. */
export interface GitHubFallbackOptions {
  /** Configured issue source — pull is only attempted when this is "github". */
  issueSource: string;
  /** Function that attempts to pull a GitHub issue into the backlog. */
  pullFn: () => import("./issues.ts").PullIssueResult;
}

// Receipt interface and functions (parseReceipt, checkReceiptSource) are
// imported from ./receipt.ts above.

export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split("\n")) {
    if (line === "") {
      if (current.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? "",
          head: current.head ?? "",
          bare: current.bare ?? false,
        });
      }
      current = {};
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // branch refs/heads/ralphai/foo → ralphai/foo
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  // Handle last entry if no trailing newline
  if (current.path) {
    entries.push({
      path: current.path,
      branch: current.branch ?? "",
      head: current.head ?? "",
      bare: current.bare ?? false,
    });
  }

  return entries;
}

export function selectPlanForWorktree(
  cwd: string,
  specificPlan?: string,
  activeWorktrees: WorktreeEntry[] = [],
  githubOptions?: GitHubFallbackOptions,
): SelectedWorktreePlan | null {
  const { backlogDir, wipDir: inProgressDir } = getRepoPipelineDirs(cwd);

  // Build set of slugs that already have an active worktree
  const activeSlugs = new Set<string>();
  for (const wt of activeWorktrees) {
    if (wt.branch.startsWith("ralphai/")) {
      activeSlugs.add(wt.branch.replace("ralphai/", ""));
    } else {
      // feat/ or other managed branches: look up plans by receipt
      for (const slug of findPlansByBranch(inProgressDir, wt.branch)) {
        activeSlugs.add(slug);
      }
    }
  }

  const resolvePlanInDir = (
    baseDir: string,
    planFile: string,
  ): string | null => {
    const slug = planFile.replace(/\.md$/, "");
    return resolvePlanPath(baseDir, slug);
  };

  // --- Specific plan requested ---
  if (specificPlan) {
    const slug = specificPlan.replace(/\.md$/, "");
    const inProgressPath = resolvePlanInDir(inProgressDir, specificPlan);
    if (inProgressPath) {
      return { planFile: specificPlan, slug, source: "in-progress" };
    }
    const backlogPath = resolvePlanInDir(backlogDir, specificPlan);
    if (backlogPath) {
      return { planFile: specificPlan, slug, source: "backlog" };
    }
    console.error(
      `Plan '${specificPlan}' not found in backlog or in-progress.`,
    );
    return null;
  }

  // --- Auto-detect plan ---

  const inProgressPlans = listPlanFiles(inProgressDir);

  // Plans without an active worktree are "unattended" — resume first
  const unattendedPlans = inProgressPlans.filter(
    (f) => !activeSlugs.has(f.replace(/\.md$/, "")),
  );

  if (unattendedPlans.length === 1) {
    const planFile = unattendedPlans[0]!;
    const slug = planFile.replace(/\.md$/, "");
    return { planFile, slug, source: "in-progress" };
  }

  if (unattendedPlans.length > 1) {
    console.error(
      `Multiple unattended in-progress plans. Use ${TEXT}ralphai run --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of unattendedPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  // No unattended plans — check backlog for new work
  const backlogPlans = listPlanFiles(backlogDir, true);

  if (backlogPlans.length > 0) {
    const firstPlan = backlogPlans[0]!;
    const slug = firstPlan.replace(/\.md$/, "");
    return { planFile: firstPlan, slug, source: "backlog" };
  }

  // No backlog — try resuming an in-progress plan that has a worktree
  const attendedPlans = inProgressPlans.filter((f) =>
    activeSlugs.has(f.replace(/\.md$/, "")),
  );

  if (attendedPlans.length === 1) {
    const planFile = attendedPlans[0]!;
    const slug = planFile.replace(/\.md$/, "");
    return { planFile, slug, source: "in-progress" };
  }

  if (attendedPlans.length > 1) {
    console.error(
      `Multiple in-progress plans with active worktrees. Use ${TEXT}ralphai run --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of attendedPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  // --- GitHub issue fallback: pull an issue if configured ---
  if (githubOptions?.issueSource === "github") {
    const result = githubOptions.pullFn();
    if (result.pulled) {
      // Re-check backlog after pulling
      const newBacklogPlans = listPlanFiles(backlogDir, true);
      if (newBacklogPlans.length > 0) {
        const firstPlan = newBacklogPlans[0]!;
        const slug = firstPlan.replace(/\.md$/, "");
        return { planFile: firstPlan, slug, source: "backlog" };
      }
    }
    console.error(`No plans in backlog and no GitHub issues available.`);
    return null;
  }

  console.error(
    `No plans in backlog. Add a plan to the pipeline backlog first.`,
  );
  return null;
}

export function isRalphaiManagedBranch(branch: string): boolean {
  return branch.startsWith("ralphai/") || branch.startsWith("feat/");
}

export function listRalphaiWorktrees(cwd: string): WorktreeEntry[] {
  const output = execSync("git worktree list --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return parseWorktreeList(output).filter((wt) =>
    isRalphaiManagedBranch(wt.branch),
  );
}

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

function showStatusHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai status [--once] [--no-color]`);
  console.log();
  console.log(
    `${DIM}Show pipeline status. Auto-refreshes every 3s in a terminal.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--once${RESET}      ${DIM}Print once and exit (default in non-TTY)${RESET}`,
  );
  console.log(
    `  ${TEXT}--no-color${RESET}  ${DIM}Disable color output${RESET}`,
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

function runBacklogDir(cwd: string): void {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (no config found).${RESET}`,
    );
    console.log(`${DIM}Run ${TEXT}ralphai init${DIM} first.${RESET}`);
    return;
  }
  const { backlogDir } = getRepoPipelineDirs(cwd);
  console.log(backlogDir);
}

function runSeed(cwd: string): void {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (no config found).${RESET}`,
    );
    console.log(`${DIM}Run ${TEXT}ralphai init${DIM} first.${RESET}`);
    return;
  }

  const {
    backlogDir,
    wipDir: inProgressDir,
    archiveDir,
  } = getRepoPipelineDirs(cwd);

  // Abort if a runner is actively executing the plan
  const ipSlugDir = join(inProgressDir, HELLO_WORLD_SLUG);
  const pidPath = join(ipSlugDir, "runner.pid");
  if (existsSync(pidPath)) {
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        // Process is alive — abort
        console.log(
          `${TEXT}Cannot seed: a runner is actively executing ${HELLO_WORLD_SLUG} (PID ${pid}).${RESET}`,
        );
        console.log(`${DIM}Stop the runner first, then retry.${RESET}`);
        return;
      } catch {
        // Process is gone — stale PID file, safe to continue
      }
    }
  }

  // Clean up any existing hello-world artifacts
  const cleaned: string[] = [];

  if (existsSync(ipSlugDir)) {
    rmSync(ipSlugDir, { recursive: true, force: true });
    cleaned.push("in-progress");
  }

  const archiveSlugDir = join(archiveDir, HELLO_WORLD_SLUG);
  if (existsSync(archiveSlugDir)) {
    rmSync(archiveSlugDir, { recursive: true, force: true });
    cleaned.push("archive");
  }

  const backlogFile = join(backlogDir, `${HELLO_WORLD_SLUG}.md`);
  if (existsSync(backlogFile)) {
    rmSync(backlogFile, { force: true });
    cleaned.push("backlog");
  }

  // Write fresh plan to backlog
  mkdirSync(backlogDir, { recursive: true });
  writeFileSync(backlogFile, HELLO_WORLD_PLAN);

  if (cleaned.length > 0) {
    console.log(
      `${TEXT}Cleaned ${HELLO_WORLD_SLUG} from: ${cleaned.join(", ")}${RESET}`,
    );
  }
  console.log(`${TEXT}Seeded ${HELLO_WORLD_SLUG} into backlog.${RESET}`);
}

function showDoctorHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai doctor`);
  console.log();
  console.log(
    `${DIM}Run diagnostic checks on your ralphai setup and report problems.${RESET}`,
  );
}

function listWorktrees(cwd: string): void {
  const worktrees = listRalphaiWorktrees(cwd);

  if (worktrees.length === 0) {
    console.log("No active ralphai worktrees.");
    return;
  }

  console.log("Active ralphai worktrees:\n");
  const { wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
  for (const wt of worktrees) {
    let hasActivePlan: boolean;
    if (wt.branch.startsWith("ralphai/")) {
      const slug = wt.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
    } else {
      // feat/ or other managed branches: use receipt-based lookup
      hasActivePlan = findPlansByBranch(inProgressDir, wt.branch).length > 0;
    }
    const status = hasActivePlan ? "in-progress" : "idle";
    console.log(`  ${wt.branch}  ${wt.path}  [${status}]`);
  }
}

function cleanWorktrees(cwd: string): void {
  // Prune stale worktree entries first
  execSync("git worktree prune", { cwd, stdio: "inherit" });

  const worktrees = listRalphaiWorktrees(cwd);

  if (worktrees.length === 0) {
    console.log("No ralphai worktrees to clean.");
    return;
  }

  const { wipDir: inProgressDir, archiveDir } = getRepoPipelineDirs(cwd);
  let cleaned = 0;

  for (const wt of worktrees) {
    let hasActivePlan: boolean;
    let matchedSlugs: string[];

    if (wt.branch.startsWith("ralphai/")) {
      const slug = wt.branch.replace("ralphai/", "");
      hasActivePlan = planExistsForSlug(inProgressDir, slug);
      matchedSlugs = hasActivePlan ? [slug] : [slug]; // always try archiving the slug
    } else {
      // feat/ or other managed branches: use receipt-based lookup
      matchedSlugs = findPlansByBranch(inProgressDir, wt.branch);
      hasActivePlan = matchedSlugs.length > 0;
    }

    if (!hasActivePlan) {
      console.log(`Removing: ${wt.path} (${wt.branch})`);
      try {
        // Use --force because the worktree may have uncommitted changes
        // from interrupted agent work.
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd,
          stdio: "inherit",
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

        // Archive receipts for matched slugs (ralphai/ has one slug,
        // feat/ may have multiple from receipt scan)
        for (const slug of matchedSlugs) {
          const planDir = join(inProgressDir, slug);
          const receiptFile = join(planDir, "receipt.txt");
          if (existsSync(receiptFile)) {
            const destDir = join(archiveDir, slug);
            mkdirSync(destDir, { recursive: true });
            const dest = join(destDir, "receipt.txt");
            renameSync(receiptFile, dest);
            console.log(`  Archived receipt: ${slug}/receipt.txt`);
          }
        }

        cleaned++;
      } catch {
        console.log(`  Warning: Could not remove ${wt.path}. Remove manually.`);
      }
    } else {
      console.log(
        `Keeping: ${wt.path} (${wt.branch}) — plan still in progress`,
      );
    }
  }

  console.log(`\nCleaned ${cleaned} worktree(s).`);
}

// ---------------------------------------------------------------------------
// Doctor command
// ---------------------------------------------------------------------------

interface DoctorCheckResult {
  status: "pass" | "fail" | "warn";
  message: string;
}

function checkConfigExists(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  if (existsSync(configPath)) {
    return { status: "pass", message: "config initialized (global state)" };
  }
  return { status: "fail", message: "config not found — run ralphai init" };
}

function checkConfigValid(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    return {
      status: "fail",
      message: "config.json not found — run ralphai init",
    };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const keys = Object.keys(config);
    return {
      status: "pass",
      message: `config.json valid (${keys.length} keys)`,
    };
  } catch {
    return {
      status: "fail",
      message: "config.json is not valid JSON",
    };
  }
}

function checkGitRepo(cwd: string): DoctorCheckResult {
  try {
    execSync("git rev-parse --git-dir", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const baseBranch = detectBaseBranch(cwd);
    return {
      status: "pass",
      message: `git repo detected (base branch: ${baseBranch})`,
    };
  } catch {
    return { status: "fail", message: "not a git repository" };
  }
}

function checkWorkingTreeClean(cwd: string): DoctorCheckResult {
  try {
    execSync("git diff --quiet HEAD", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: "pass", message: "working tree clean" };
  } catch {
    return { status: "warn", message: "working tree has uncommitted changes" };
  }
}

function checkBaseBranchExists(cwd: string): DoctorCheckResult {
  // Read baseBranch from config if available, else detect
  let baseBranch: string;
  const configPath = getConfigFilePath(cwd);
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    baseBranch = config.baseBranch || detectBaseBranch(cwd);
  } catch {
    baseBranch = detectBaseBranch(cwd);
  }

  try {
    execSync(`git show-ref --verify refs/heads/${baseBranch}`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      status: "pass",
      message: `base branch exists: ${baseBranch}`,
    };
  } catch {
    return {
      status: "fail",
      message: `base branch not found: ${baseBranch}`,
    };
  }
}

function checkAgentCommand(cwd: string): DoctorCheckResult {
  const configPath = getConfigFilePath(cwd);
  let agentCommand: string;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    agentCommand = config.agentCommand;
  } catch {
    return { status: "fail", message: "agent command: cannot read config" };
  }

  if (!agentCommand) {
    return { status: "fail", message: "agent command: not configured" };
  }

  // Extract the first token (the executable) from the command
  const executable = agentCommand.split(/\s+/)[0]!;

  try {
    execSync(`which ${executable}`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return {
      status: "pass",
      message: `agent: ${agentCommand} — found in PATH`,
    };
  } catch {
    return {
      status: "fail",
      message: `agent: ${executable} — not found in PATH`,
    };
  }
}

function checkFeedbackCommands(cwd: string): DoctorCheckResult[] {
  const configPath = getConfigFilePath(cwd);
  let feedbackCommands: string[];
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    feedbackCommands = config.feedbackCommands;
  } catch {
    return [];
  }

  if (
    !feedbackCommands ||
    !Array.isArray(feedbackCommands) ||
    feedbackCommands.length === 0
  ) {
    return [{ status: "warn", message: "feedback commands: none configured" }];
  }

  return feedbackCommands.map((cmd) => {
    try {
      execSync(cmd, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
      return {
        status: "pass" as const,
        message: `feedback: ${cmd} — exits 0`,
      };
    } catch {
      return {
        status: "warn" as const,
        message: `feedback: ${cmd} — exits non-zero`,
      };
    }
  });
}

function checkWorkspaceFeedbackCommands(cwd: string): DoctorCheckResult[] {
  const configPath = getConfigFilePath(cwd);
  let workspaces: Record<string, { feedbackCommands?: string[] }>;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    workspaces = config.workspaces;
  } catch {
    return [];
  }

  if (!workspaces || typeof workspaces !== "object") {
    return [];
  }

  const results: DoctorCheckResult[] = [];
  for (const [wsPath, wsConfig] of Object.entries(workspaces)) {
    const commands = wsConfig?.feedbackCommands;
    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      continue;
    }
    for (const cmd of commands) {
      try {
        execSync(cmd, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15000,
        });
        results.push({
          status: "pass" as const,
          message: `feedback (${wsPath}): ${cmd} — exits 0`,
        });
      } catch {
        results.push({
          status: "warn" as const,
          message: `feedback (${wsPath}): ${cmd} — exits non-zero`,
        });
      }
    }
  }
  return results;
}

function checkBacklogHasPlans(cwd: string): DoctorCheckResult {
  const { backlogDir } = getRepoPipelineDirs(cwd);
  if (!existsSync(backlogDir)) {
    return { status: "warn", message: "backlog: directory not found" };
  }
  const plans = listPlanSlugs(backlogDir, true);
  if (plans.length === 0) {
    return { status: "warn", message: "backlog: no plans queued" };
  }
  return {
    status: "pass",
    message: `backlog: ${plans.length} plan${plans.length !== 1 ? "s" : ""} ready`,
  };
}

function checkOrphanedReceipts(cwd: string): DoctorCheckResult {
  const { wipDir: inProgressDir } = getRepoPipelineDirs(cwd);
  if (!existsSync(inProgressDir)) {
    return { status: "pass", message: "no orphaned receipts" };
  }

  const orphaned: string[] = [];
  for (const slug of listPlanFolders(inProgressDir)) {
    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    if (!existsSync(receiptPath)) continue;
    const planPath = join(inProgressDir, slug, `${slug}.md`);
    if (!existsSync(planPath)) {
      orphaned.push(`${slug}/receipt.txt`);
    }
  }

  if (orphaned.length > 0) {
    return {
      status: "warn",
      message: `orphaned receipts: ${orphaned.join(", ")}`,
    };
  }
  return { status: "pass", message: "no orphaned receipts" };
}

function runRalphaiDoctor(cwd: string): void {
  const statusIcons: Record<DoctorCheckResult["status"], string> = {
    pass: "\u2713",
    fail: "\u2717",
    warn: "\u26A0",
  };

  let failures = 0;
  let warnings = 0;

  // Print header immediately so the user sees output right away.
  console.log();
  console.log(`${TEXT}ralphai doctor${RESET}`);
  console.log();

  function emit(result: DoctorCheckResult): void {
    if (result.status === "fail") failures++;
    if (result.status === "warn") warnings++;
    const icon = statusIcons[result.status];
    console.log(`  ${icon} ${DIM}${result.message}${RESET}`);
  }

  function emitAll(results: DoctorCheckResult[]): void {
    for (const r of results) emit(r);
  }

  // 1. Config exists
  const configExists = checkConfigExists(cwd);
  emit(configExists);

  // 2. config.json valid
  const configValid = checkConfigValid(cwd);
  emit(configValid);

  // 3. Git repo detected
  const gitRepo = checkGitRepo(cwd);
  emit(gitRepo);

  // 4. Working tree clean (only if git repo detected)
  if (gitRepo.status !== "fail") {
    emit(checkWorkingTreeClean(cwd));
  }

  // 5. Base branch exists (only if git repo detected)
  if (gitRepo.status !== "fail") {
    emit(checkBaseBranchExists(cwd));
  }

  // 6. Agent command in PATH (only if config valid)
  if (configValid.status !== "fail") {
    emit(checkAgentCommand(cwd));
  }

  // 7. Feedback commands (only if config valid)
  if (configValid.status !== "fail") {
    emitAll(checkFeedbackCommands(cwd));
  }

  // 7b. Workspace feedback commands (only if config valid)
  if (configValid.status !== "fail") {
    emitAll(checkWorkspaceFeedbackCommands(cwd));
  }

  // 8. Backlog has plans (only if config exists)
  if (configExists.status !== "fail") {
    emit(checkBacklogHasPlans(cwd));
  }

  // 9. No orphaned receipts (only if config exists)
  if (configExists.status !== "fail") {
    emit(checkOrphanedReceipts(cwd));
  }

  // --- Summary ---
  console.log();
  if (failures > 0 || warnings > 0) {
    const parts: string[] = [];
    if (warnings > 0)
      parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
    if (failures > 0)
      parts.push(`${failures} failure${failures !== 1 ? "s" : ""}`);
    console.log(`  ${DIM}${parts.join(", ")}${RESET}`);
  } else {
    console.log(`  ${DIM}All checks passed${RESET}`);
  }
  console.log();

  // Exit code: 1 if any check failed, 0 otherwise (warnings don't count)
  if (failures > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

// extractScope and extractDependsOn are imported from ./frontmatter.ts
export { extractScope, extractDependsOn } from "./frontmatter.ts";

export function runRalphaiStatus(opts: { cwd: string; once?: boolean }): void {
  const { cwd, once } = opts;
  // Verify config exists (global state)
  if (!existsSync(getConfigFilePath(cwd))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const isTTY = process.stdout.isTTY === true;

  // If non-TTY or --once, print once and return
  if (!isTTY || once) {
    printStatusOnce(cwd);
    return;
  }

  // Auto-watch mode: clear screen and reprint every 3 seconds
  const print = () => {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + move cursor to top
    printStatusOnce(cwd);
  };

  print();
  const interval = setInterval(print, 3000);

  const cleanup = () => {
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export function printStatusOnce(cwd: string): void {
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(cwd);
  } catch {
    // Not in a git repo or git not available
  }

  const state = gatherPipelineState(cwd, { worktrees });

  // --- Pipeline section ---
  console.log();
  console.log(`${TEXT}Pipeline${RESET}`);

  // Backlog
  console.log();
  console.log(
    `  ${TEXT}Backlog${RESET}      ${DIM}${state.backlog.length} plan${state.backlog.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of state.backlog) {
    let suffix = "";
    const suffixParts: string[] = [];
    if (plan.scope) {
      suffixParts.push(`scope: ${plan.scope}`);
    }
    if (plan.dependsOn.length > 0) {
      suffixParts.push(`waiting on ${plan.dependsOn.join(", ")}`);
    }
    if (suffixParts.length > 0) {
      suffix = `${DIM}${suffixParts.join("  ")}${RESET}`;
    }
    console.log(
      `    ${DIM}${plan.filename}${RESET}${suffix ? "  " + suffix : ""}`,
    );
  }

  // In Progress
  console.log();
  console.log(
    `  ${TEXT}In Progress${RESET}  ${DIM}${state.inProgress.length} plan${state.inProgress.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of state.inProgress) {
    const parts: string[] = [];

    if (plan.scope) {
      parts.push(`scope: ${plan.scope}`);
    }

    if (plan.totalTasks !== undefined && plan.totalTasks > 0) {
      parts.push(`${plan.tasksCompleted} of ${plan.totalTasks} tasks`);
    }

    if (plan.hasWorktree) {
      parts.push(`worktree: ${plan.slug}`);
    }

    // Liveness tag
    switch (plan.liveness.tag) {
      case "outcome":
        parts.push(`[${plan.liveness.outcome}]`);
        break;
      case "running":
        parts.push(`[running PID ${plan.liveness.pid}]`);
        break;
      case "stalled":
        parts.push(`${RESET}${BOLD}[stalled]${RESET}`);
        break;
      case "in_progress":
        parts.push("[in progress]");
        break;
    }

    const suffix =
      parts.length > 0 ? `${DIM}${parts.join("    ")}${RESET}` : "";
    console.log(
      `    ${DIM}${plan.filename}${RESET}${suffix ? "  " + suffix : ""}`,
    );
  }

  // Completed
  console.log();
  console.log(
    `  ${TEXT}Completed${RESET}    ${DIM}${state.completedSlugs.length} plan${state.completedSlugs.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const slug of state.completedSlugs) {
    console.log(`    ${DIM}${slug}.md${RESET}`);
  }

  // --- Worktrees section ---
  if (state.worktrees.length > 0) {
    console.log();
    console.log(`${TEXT}Worktrees${RESET}`);
    console.log();
    for (const wt of state.worktrees) {
      const wtState = wt.hasActivePlan ? "in-progress" : "idle";
      console.log(
        `  ${DIM}${wt.entry.branch}${RESET}  ${DIM}${wt.entry.path}${RESET}  ${DIM}[${wtState}]${RESET}`,
      );
    }
  }

  // --- Problems section ---
  if (state.problems.length > 0) {
    console.log();
    console.log(`${TEXT}Problems${RESET}`);
    console.log();
    for (const p of state.problems) {
      console.log(`  ${DIM}${p.message}${RESET}`);
    }
  }

  console.log();
}

async function runRalphaiWorktree(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const wtOpts = options.worktreeOptions ?? {
    subcommand: "run",
    runArgs: [],
  };

  // Handle --help
  if (wtOpts.runArgs.includes("--help") || wtOpts.runArgs.includes("-h")) {
    showRalphaiHelp();
    return;
  }

  // Dispatch worktree sub-subcommands
  switch (wtOpts.subcommand) {
    case "list":
      listWorktrees(cwd);
      return;
    case "clean":
      cleanWorktrees(cwd);
      return;
    case "run":
      console.error("'ralphai worktree' no longer starts runs.");
      console.error(
        "Use 'ralphai run' to create or reuse a worktree and execute work.",
      );
      process.exit(1);
  }
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
  /^--base-branch=/,
  /^--max-stuck=/,
  /^--iteration-timeout=/,
  /^--auto-commit$/,
  /^--no-auto-commit$/,
  /^--prompt-mode=/,
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
    "  --once                           Run a single plan then exit (default: drain backlog)",
    "  --resume, -r                     Auto-commit dirty state and continue",
    "  --allow-dirty                    Skip the clean working tree check",
    "  --plan=<file>                    Target a specific backlog plan (default: auto-detect)",
    "  --agent-command=<command>        Override agent CLI command (e.g. 'claude -p')",
    "  --setup-command=<command>        Command to run in worktree after creation (e.g. 'bun install')",
    "  --feedback-commands=<list>       Comma-separated feedback commands (e.g. 'npm test,npm run build')",
    "  --base-branch=<branch>           Override base branch (default: main)",
    "  --max-stuck=<n>                  Override stuck threshold (default: 3)",
    "  --iteration-timeout=<seconds>     Timeout per agent invocation (default: 0 = no timeout)",
    "  --auto-commit                    Enable auto-commit of agent changes (per-iteration and resume recovery)",
    "  --no-auto-commit                 Disable auto-commit recovery snapshots (default: off)",
    "  --prompt-mode=<mode>             Prompt file ref format: 'auto', 'at-path', or 'inline' (default: auto)",
    "  --show-config                    Print resolved settings and exit",
    "  --help, -h                       Show this help message",
    "",
    "Config file: config.json (optional, JSON format, stored in ~/.ralphai/repos/<id>/)",
    "  Supported keys: agentCommand, setupCommand, feedbackCommands, baseBranch, maxStuck,",
    "                  autoCommit, iterationTimeout, promptMode,",
    "                  issueSource, issueLabel,",
    "                  issueInProgressLabel, issueDoneLabel, issueRepo,",
    "                  issueCommentProgress",
    "",
    "Env var overrides: RALPHAI_AGENT_COMMAND, RALPHAI_SETUP_COMMAND,",
    "                   RALPHAI_FEEDBACK_COMMANDS,",
    "                   RALPHAI_BASE_BRANCH, RALPHAI_MAX_STUCK,",
    "                   RALPHAI_AUTO_COMMIT,",
    "                   RALPHAI_ITERATION_TIMEOUT,",
    "                   RALPHAI_PROMPT_MODE,",
    "                   RALPHAI_ISSUE_SOURCE,",
    "                   RALPHAI_ISSUE_LABEL, RALPHAI_ISSUE_IN_PROGRESS_LABEL,",
    "                   RALPHAI_ISSUE_DONE_LABEL,",
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
// prd subcommand — sugar for `ralphai run --prd=<number>`
// ---------------------------------------------------------------------------

async function runRalphaiPrd(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const { prdNumber } = options;

  // Missing issue number
  if (!prdNumber) {
    console.error("Usage: ralphai prd <issue-number>");
    console.error(
      `${DIM}Run ${TEXT}ralphai prd --help${RESET}${DIM} for details.${RESET}`,
    );
    process.exit(1);
  }

  // Non-numeric issue number
  const num = parseInt(prdNumber, 10);
  if (isNaN(num) || String(num) !== prdNumber) {
    console.error(
      `Invalid issue number: '${prdNumber}'. The issue number must be a positive integer.`,
    );
    console.error(`${DIM}Example: ${TEXT}ralphai prd 42${RESET}`);
    process.exit(1);
  }

  // Reject if inside a worktree
  if (isGitWorktree(cwd)) {
    console.error("'ralphai prd' must be run from the main repository.");
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  // Delegate to `runRalphaiInManagedWorktree` with --prd=<number> injected.
  const runArgs = [...options.runArgs];
  runArgs.push(`--prd=${prdNumber}`);

  const delegatedOptions: RalphaiOptions = {
    ...options,
    subcommand: "run",
    runArgs,
  };

  await runRalphaiInManagedWorktree(delegatedOptions, cwd);
}

/**
 * Resolve worktree state for the given directory.
 * Returns { isWorktree, mainWorktree } where mainWorktree is the root
 * of the main worktree (empty string if not in a worktree).
 */
function resolveWorktreeInfo(dir: string): {
  isWorktree: boolean;
  mainWorktree: string;
} {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: dir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    if (commonDir !== gitDir) {
      // In a worktree: --git-common-dir points to the main .git
      const mainRoot = resolve(dir, commonDir, "..");
      return { isWorktree: true, mainWorktree: mainRoot };
    }
  } catch {
    // Not in a git repo or git not available
  }
  return { isWorktree: false, mainWorktree: "" };
}

/**
 * Run a setup command inside a freshly-created worktree directory.
 * Called only when a new worktree is created (not reused).
 * On failure the process exits with code 1.
 */
function executeSetupCommand(setupCommand: string, worktreeDir: string): void {
  if (!setupCommand) return;
  console.log(`Running setup command: ${setupCommand}`);
  try {
    execSync(setupCommand, {
      cwd: worktreeDir,
      stdio: "inherit",
    });
  } catch (err: unknown) {
    const stderr = extractExecStderr(err);
    console.error(
      `${TEXT}Error:${RESET} Setup command failed: ${setupCommand}`,
    );
    if (stderr) console.error(`  ${stderr}`);
    console.error(
      `\nFix the issue and re-run, or set ${TEXT}setupCommand${RESET} to "" in config to disable.`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Explicit target handlers: `ralphai run <issue-number>` / `ralphai run <plan.md>`
// ---------------------------------------------------------------------------

/**
 * Handle `ralphai run <issue-number>` — fetch the GitHub issue, determine
 * whether it is a PRD (has `ralphai-prd` label), and either:
 *
 * 1. **Non-PRD** — pull the issue into a plan file, create a `feat/<slug>`
 *    branch and worktree, run the agent once, open a PR on completion.
 * 2. **PRD with unchecked sub-issues** — create a single `feat/<slug>`
 *    worktree and work through each sub-issue sequentially.
 * 3. **PRD all completed** — report and exit.
 * 4. **PRD no task list** — error with guidance to add sub-issues.
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
  },
): Promise<void> {
  const { isDryRun, hasHelp, hasShowConfig, setupCommand } = flags;

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

  // Discover whether this issue is a PRD or a standalone issue
  let discovery: PrdDiscoveryResult;
  try {
    discovery = discoverPrdTarget(repo, issueNumber, cwd);
  } catch (err: unknown) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      `\nCheck that issue #${issueNumber} exists and you have access to ${repo}.`,
    );
    process.exit(1);
  }

  if (discovery.isPrd) {
    return runPrdIssueTarget(discovery, repo, options, runArgs, cwd, flags);
  }

  // --- Non-PRD: standalone issue flow (unchanged) ---
  const { issue } = discovery;
  const issueTitle = issue.title;
  const issueSlug = slugify(issueTitle);
  const branch = `feat/${issueSlug}`;

  // Dry-run: preview and exit
  if (isDryRun) {
    console.log();
    console.log("========================================");
    console.log("  Ralphai dry-run — issue target");
    console.log("========================================");
    console.log(`[dry-run] Issue: #${issueNumber} — ${issueTitle}`);
    console.log(`[dry-run] Branch: ${branch}`);
    console.log(`[dry-run] Worktree: ../.ralphai-worktrees/${issueSlug}/`);
    console.log("[dry-run] Mode: single target (no drain)");
    console.log(
      "[dry-run] No files moved, no worktrees created, no agent run executed.",
    );
    return;
  }

  // Ensure repo has at least one commit
  ensureRepoHasCommit(cwd);

  const baseBranch = detectBaseBranch(cwd);
  const resolvedWorktreeDir = prepareWorktree(
    cwd,
    issueSlug,
    branch,
    baseBranch,
    setupCommand,
  );

  // Pull the issue into a plan file in the worktree's pipeline
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
    issueLabel: worktreeConfig.issueLabel.value,
    issueInProgressLabel: worktreeConfig.issueInProgressLabel.value,
    issueDoneLabel: worktreeConfig.issueDoneLabel.value,
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
  },
): Promise<void> {
  const { isDryRun, setupCommand } = flags;
  const { prd, subIssues, allCompleted } = discovery;
  const prdSlug = slugify(prd.title);
  const branch = `feat/${prdSlug}`;

  // --- All sub-issues already completed ---
  if (allCompleted) {
    console.log();
    console.log(
      `PRD #${prd.number} — ${prd.title}: all sub-issues already completed.`,
    );
    return;
  }

  // --- PRD with no task list: error out ---
  if (subIssues.length === 0) {
    console.error(`PRD #${prd.number} has no sub-issue task list.`);
    console.error(
      `Add ${BOLD}- [ ] #<issue>${RESET} items to the PRD body, then retry.`,
    );
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
      "[dry-run] No files moved, no worktrees created, no agent run executed.",
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
  );

  const worktreeConfig = resolveWorktreeConfig(
    resolvedWorktreeDir,
    cwd,
    runArgs,
  );

  // --- PRD with unchecked sub-issues: work through sequentially ---
  console.log(
    `PRD #${prd.number} — ${prd.title}: ${subIssues.length} sub-issue(s) to work through.`,
  );
  console.log(`Sub-issues: ${subIssues.map((n) => `#${n}`).join(", ")}`);

  const stuckSubIssues: number[] = [];
  const completedSubIssues: number[] = [];
  let completedCount = 0;

  for (const subIssueNumber of subIssues) {
    console.log();
    console.log("----------------------------------------");
    console.log(
      `PRD #${prd.number} — working on sub-issue #${subIssueNumber} (${completedCount + 1}/${subIssues.length})`,
    );
    console.log("----------------------------------------");

    // Pull the sub-issue into a plan file
    const { backlogDir } = getRepoPipelineDirs(resolvedWorktreeDir);

    const pullResult = pullGithubIssueByNumber({
      backlogDir,
      cwd: resolvedWorktreeDir,
      issueSource: "github",
      issueLabel: worktreeConfig.issueLabel.value,
      issueInProgressLabel: worktreeConfig.issueInProgressLabel.value,
      issueDoneLabel: worktreeConfig.issueDoneLabel.value,
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
      await runRalphaiRunner(
        worktreeRunOptions,
        resolvedWorktreeDir,
        {
          number: prd.number,
          title: prd.title,
        },
        { skipPrCreation: true },
      );
      completedCount++;
      completedSubIssues.push(subIssueNumber);
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
  console.log("========================================");
  console.log(`  PRD #${prd.number} — summary`);
  console.log("========================================");
  console.log(`Completed: ${completedCount}/${subIssues.length} sub-issue(s)`);
  if (stuckSubIssues.length > 0) {
    console.log(
      `Stuck/skipped: ${stuckSubIssues.map((n) => `#${n}`).join(", ")}`,
    );
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
      cwd: resolvedWorktreeDir,
      issueRepo,
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

/** Ensure the repo has at least one commit (required for worktrees). */
function ensureRepoHasCommit(cwd: string): void {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
  } catch {
    console.error(
      "This repository has no commits yet. Git worktrees require at least one commit.",
    );
    console.error(
      `\n  ${TEXT}git add . && git commit -m "initial commit"${RESET}`,
    );
    console.error(`\nThen re-run ${TEXT}ralphai run${RESET}.`);
    process.exit(1);
  }
}

/**
 * Create or reuse a worktree for a given slug/branch.
 * Returns the resolved worktree directory path.
 */
function prepareWorktree(
  cwd: string,
  slug: string,
  branch: string,
  baseBranch: string,
  setupCommand: string,
): string {
  const worktreeBase = join(cwd, "..", ".ralphai-worktrees");
  const desiredWorktreeDir = join(worktreeBase, slug);
  mkdirSync(worktreeBase, { recursive: true });

  const activeWorktrees = listRalphaiWorktrees(cwd);
  const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);

  let resolvedWorktreeDir = desiredWorktreeDir;
  if (activeWorktree) {
    resolvedWorktreeDir = activeWorktree.path;
    console.log(`Reusing existing worktree: ${resolvedWorktreeDir}`);
    console.log(`Branch: ${branch}`);
  } else {
    if (existsSync(resolvedWorktreeDir)) {
      console.log(
        `Cleaning up orphaned worktree directory: ${resolvedWorktreeDir}`,
      );
      execSync("git worktree prune", { cwd, stdio: "ignore" });
      rmSync(resolvedWorktreeDir, { recursive: true, force: true });
    }

    let branchExists = false;
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
        cwd,
        stdio: "ignore",
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    try {
      if (branchExists) {
        console.log(`Recreating worktree: ${resolvedWorktreeDir}`);
        console.log(`Branch: ${branch}`);
        execSync(`git worktree add "${resolvedWorktreeDir}" "${branch}"`, {
          cwd,
          stdio: ["inherit", "pipe", "pipe"],
        });
      } else {
        console.log(`Creating worktree: ${resolvedWorktreeDir}`);
        console.log(`Branch: ${branch} (from ${baseBranch})`);
        execSync(
          `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`,
          { cwd, stdio: ["inherit", "pipe", "pipe"] },
        );
      }
    } catch (err: unknown) {
      const stderr = extractExecStderr(err);
      console.error(`${TEXT}Error:${RESET} Failed to prepare worktree.`);
      if (stderr) console.error(`  git: ${stderr}`);
      process.exit(1);
    }
  }

  // Run setup command in freshly-created worktrees (not reused ones)
  if (!activeWorktree) {
    executeSetupCommand(setupCommand, resolvedWorktreeDir);
  }

  return resolvedWorktreeDir;
}

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

  // Check for removed flags before any other processing
  if (!hasHelp && !hasShowConfig) {
    handleRemovedRunFlags(runArgs);
  }

  const isDryRun = runArgs.includes("--dry-run") || runArgs.includes("-n");
  const planFlag = runArgs.find((a) => a.startsWith("--plan="));
  const targetPlan = planFlag ? planFlag.slice("--plan=".length) : undefined;

  // Resolve config from config/env/CLI (read-only, safe for dry-run)
  let setupCommand = "";
  let resolvedIssueSource = "none";
  let resolvedIssueLabel = "ralphai";
  let resolvedIssueInProgressLabel = "ralphai:in-progress";
  let resolvedIssueDoneLabel = "ralphai:done";
  let resolvedIssueRepo = "";
  let resolvedIssueCommentProgress = false;
  try {
    const cfgResult = resolveConfig({
      cwd,
      envVars: process.env as Record<string, string | undefined>,
      cliArgs: runArgs,
    });
    setupCommand = cfgResult.config.setupCommand.value;
    resolvedIssueSource = cfgResult.config.issueSource.value;
    resolvedIssueLabel = cfgResult.config.issueLabel.value;
    resolvedIssueInProgressLabel = cfgResult.config.issueInProgressLabel.value;
    resolvedIssueDoneLabel = cfgResult.config.issueDoneLabel.value;
    resolvedIssueRepo = cfgResult.config.issueRepo.value;
    resolvedIssueCommentProgress =
      cfgResult.config.issueCommentProgress.value === "true";
  } catch {
    // Config resolution may fail if not yet initialised; setup will be skipped
  }

  // --- Handle explicit positional target: `ralphai run 42` or `ralphai run my-feature.md` ---
  const target = options.runTarget;

  if (target?.type === "issue") {
    return runIssueTarget(target.number, options, runArgs, cwd, {
      isDryRun,
      hasHelp,
      hasShowConfig,
      setupCommand,
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
        if (!isDryRun) {
          ensurePrdLabel(cwd);
        }
        prdIssue = fetchPrdIssueByNumber(repo, prdNum, cwd);
      } catch (err: unknown) {
        console.error(
          `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      const prdSlug = slugify(prdIssue.title);
      const branch = prdBranchName(prdIssue.title);

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
          "[dry-run] No files moved, no worktrees created, no agent run executed.",
        );
        return;
      }

      // --- Real PRD run: create worktree with PRD-derived branch ---
      try {
        execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
      } catch {
        console.error(
          `This repository has no commits yet. Git worktrees require at least one commit.`,
        );
        console.error(
          `\n  ${TEXT}git add . && git commit -m "initial commit"${RESET}`,
        );
        console.error(`\nThen re-run ${TEXT}ralphai run${RESET}.`);
        process.exit(1);
      }

      const baseBranch = detectBaseBranch(cwd);
      const worktreeBase = join(cwd, "..", ".ralphai-worktrees");
      const desiredWorktreeDir = join(worktreeBase, prdSlug);
      mkdirSync(worktreeBase, { recursive: true });

      // Check for active worktree on this branch
      const activeWorktrees = listRalphaiWorktrees(cwd);
      const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);

      let resolvedWorktreeDir = desiredWorktreeDir;
      if (activeWorktree) {
        resolvedWorktreeDir = activeWorktree.path;
        console.log(`Reusing existing worktree: ${resolvedWorktreeDir}`);
        console.log(`Branch: ${branch}`);
      } else {
        if (existsSync(resolvedWorktreeDir)) {
          console.log(
            `Cleaning up orphaned worktree directory: ${resolvedWorktreeDir}`,
          );
          execSync("git worktree prune", { cwd, stdio: "ignore" });
          rmSync(resolvedWorktreeDir, { recursive: true, force: true });
        }

        let branchExists = false;
        try {
          execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
            cwd,
            stdio: "ignore",
          });
          branchExists = true;
        } catch {
          branchExists = false;
        }

        try {
          if (branchExists) {
            console.log(`Recreating worktree: ${resolvedWorktreeDir}`);
            console.log(`Branch: ${branch}`);
            execSync(`git worktree add "${resolvedWorktreeDir}" "${branch}"`, {
              cwd,
              stdio: ["inherit", "pipe", "pipe"],
            });
          } else {
            console.log(`Creating worktree: ${resolvedWorktreeDir}`);
            console.log(`Branch: ${branch} (from ${baseBranch})`);
            execSync(
              `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`,
              { cwd, stdio: ["inherit", "pipe", "pipe"] },
            );
          }
        } catch (err: unknown) {
          const stderr = extractExecStderr(err);
          console.error(`${TEXT}Error:${RESET} Failed to prepare worktree.`);
          if (stderr) console.error(`  git: ${stderr}`);
          process.exit(1);
        }
      }

      // Run setup command in freshly-created worktrees (not reused ones)
      if (!activeWorktree) {
        executeSetupCommand(setupCommand, resolvedWorktreeDir);
      }

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

  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
  } catch {
    console.error(
      `This repository has no commits yet. Git worktrees require at least one commit.`,
    );
    console.error(
      `\n  ${TEXT}git add . && git commit -m "initial commit"${RESET}`,
    );
    console.error(`\nThen re-run ${TEXT}ralphai run${RESET}.`);
    process.exit(1);
  }

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
              issueLabel: resolvedIssueLabel,
              issueInProgressLabel: resolvedIssueInProgressLabel,
              issueDoneLabel: resolvedIssueDoneLabel,
              issueRepo: resolvedIssueRepo,
              issueCommentProgress: resolvedIssueCommentProgress,
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

    const branch = `ralphai/${plan.slug}`;
    const resolvedWorktreeDir = prepareWorktree(
      cwd,
      plan.slug,
      branch,
      baseBranch,
      setupCommand,
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
): Promise<void> {
  const worktreeInfo = resolveWorktreeInfo(cwd);
  const runArgs = options.runArgs;

  // --- Handle --help ---
  if (runArgs.includes("--help") || runArgs.includes("-h")) {
    showRunHelp();
    return;
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
    return;
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
        intake: config.issueLabel.value,
        inProgress: config.issueInProgressLabel.value,
        done: config.issueDoneLabel.value,
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

  await runRunner(runnerOpts);
}

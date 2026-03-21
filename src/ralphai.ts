import { execSync, spawn } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  renameSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as clack from "@clack/prompts";
import { RESET, DIM, TEXT } from "./utils.ts";
import { runSelfUpdate } from "./self-update.ts";
import { extractScope } from "./frontmatter.ts";
import {
  detectFeedbackCommands,
  detectWorkspaces,
  detectProject,
} from "./project-detection.ts";
import type { DetectedProject, WorkspacePackage } from "./project-detection.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RalphaiSubcommand =
  | "init"
  | "update"
  | "run"
  | "teardown"
  | "worktree"
  | "status"
  | "reset"
  | "purge"
  | "doctor";

type WorktreeSubcommand = "run" | "list" | "clean";

interface WorktreeOptions {
  subcommand: WorktreeSubcommand;
  plan?: string; // --plan=<file>
  dir?: string; // --dir=<path>
  runArgs: string[]; // passthrough args for the runner (--turns, --agent-command, etc.)
}

interface RalphaiOptions {
  subcommand: RalphaiSubcommand | undefined;
  yes: boolean;
  force: boolean;
  shared: boolean;
  agentCommand?: string;
  targetDir?: string;
  runArgs: string[];
  worktreeOptions?: WorktreeOptions;
  unknownFlags: string[];
}

interface WizardAnswers {
  agentCommand: string;
  baseBranch: string;
  feedbackCommands: string;
  turns?: number;
  mode?: "branch" | "pr" | "patch";
  autoCommit?: boolean;
  issueSource: "none" | "github";
  createSamplePlan?: boolean;
  updateAgentsMd?: boolean;
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
// Options parsing
// ---------------------------------------------------------------------------

const SUBCOMMANDS = new Set<RalphaiSubcommand>([
  "init",
  "update",
  "run",
  "teardown",
  "worktree",
  "status",
  "reset",
  "purge",
  "doctor",
]);

function parseRalphaiOptions(args: string[]): RalphaiOptions {
  let subcommand: RalphaiSubcommand | undefined;
  let yes = false;
  let force = false;
  let shared = false;
  let agentCommand: string | undefined;
  let targetDir: string | undefined;
  const runArgs: string[] = [];
  let worktreeOptions: WorktreeOptions | undefined;
  const unknownFlags: string[] = [];

  let collectingRunArgs = false;

  for (const arg of args) {
    // After `run` subcommand or `--`, collect remaining args for the task runner
    if (collectingRunArgs) {
      if (arg === "--") continue; // skip bare `--` separator (still supported)
      runArgs.push(arg);
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
    } else if (arg === "--shared") {
      shared = true;
    } else if (arg === "--help" || arg === "-h") {
      // Handled by runRalphai() dispatcher — skip here
    } else if (arg === "--no-color") {
      // Handled by utils.ts at module load — skip here
    } else if (arg.startsWith("--agent-command=")) {
      agentCommand = arg.slice("--agent-command=".length);
    } else if (!arg.startsWith("-")) {
      // First non-flag arg is the subcommand; second is targetDir
      if (!subcommand && SUBCOMMANDS.has(arg as RalphaiSubcommand)) {
        subcommand = arg as RalphaiSubcommand;
        // For `run`, everything after is forwarded to the task runner
        if (subcommand === "run") {
          collectingRunArgs = true;
        }
        // For `worktree`, parse worktree-specific args from the rest
        if (subcommand === "worktree") {
          worktreeOptions = parseWorktreeArgs(
            args.slice(args.indexOf(arg) + 1),
          );
          break; // worktree parser consumed remaining args
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
    shared,
    agentCommand,
    targetDir,
    runArgs,
    worktreeOptions,
    unknownFlags,
  };
}

const WORKTREE_SUBCOMMANDS = new Set<WorktreeSubcommand>(["list", "clean"]);

function parseWorktreeArgs(args: string[]): WorktreeOptions {
  let wtSubcommand: WorktreeSubcommand = "run"; // default
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
// Git error extraction
// ---------------------------------------------------------------------------

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
  clack.intro("Setting up Ralphai — autonomous task runner");

  clack.note(
    "Ralphai picks up plan files from .ralphai/pipeline/backlog/ and drives an AI\n" +
      "coding agent to implement them autonomously, with built-in\n" +
      "feedback loops, git hygiene, and safety rails.",
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

  // 4. Turns per plan
  const turnsInput = await clack.text({
    message: "Turns per plan (0 = unlimited):",
    initialValue: "5",
    validate: (value) => {
      if (!/^[0-9]+$/.test(value.trim()))
        return "Must be a non-negative integer (0 = unlimited)";
    },
  });

  if (clack.isCancel(turnsInput)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  const turns = parseInt(turnsInput, 10);

  // 5. Workflow mode
  const modeSelection = await clack.select({
    message: "Workflow mode:",
    options: [
      {
        value: "branch",
        label: "Branch",
        hint: "create a branch, don't push or open a PR",
      },
      {
        value: "pr",
        label: "PR",
        hint: "create a branch and open a pull request",
      },
      {
        value: "patch",
        label: "Patch",
        hint: "leave changes uncommitted in the working tree",
      },
    ],
  });

  if (clack.isCancel(modeSelection)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  const mode = modeSelection as "branch" | "pr" | "patch";

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

  // 7. Sample plan
  const createSamplePlan = await clack.confirm({
    message: "Create a sample plan to try your first run?",
    initialValue: true,
  });

  if (clack.isCancel(createSamplePlan)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 8. Update AGENTS.md
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

  return {
    agentCommand,
    baseBranch,
    feedbackCommands: feedbackCommands || "",
    turns,
    mode,
    autoCommit,
    issueSource: enableIssues ? "github" : "none",
    createSamplePlan,
    updateAgentsMd,
  };
}

// ---------------------------------------------------------------------------
// Teardown logic
// ---------------------------------------------------------------------------

async function teardownRalphai(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const ralphaiDir = join(cwd, ".ralphai");

  if (!existsSync(ralphaiDir)) {
    console.log(
      `${TEXT}Ralphai is not set up in this project (.ralphai/ does not exist).${RESET}`,
    );
    return;
  }

  if (!options.yes) {
    clack.intro("Tearing down Ralphai");
    const confirmed = await clack.confirm({
      message:
        "This will permanently delete .ralphai/. " +
        "Any plans and learnings in .ralphai/ will be lost. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Teardown cancelled.");
      return;
    }
  }

  // Remove .ralphai/ directory
  rmSync(ralphaiDir, { recursive: true, force: true });

  console.log(`${TEXT}Ralphai torn down.${RESET}`);
  console.log();
  console.log(`${DIM}Removed:${RESET}`);
  console.log(`  .ralphai/                  ${DIM}Entire directory${RESET}`);
  console.log();
}

// ---------------------------------------------------------------------------
// GitHub label creation
// ---------------------------------------------------------------------------

interface LabelResult {
  success: boolean;
  error?: string;
}

/**
 * Create the `ralphai` and `ralphai:in-progress` labels on the GitHub repo.
 * Uses `gh label create --force` so it is idempotent. Never throws —
 * label creation is best-effort.
 */
function ensureGitHubLabels(cwd: string): LabelResult {
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
    execSync(
      'gh label create ralphai --description "Ralphai picks up this issue" --color 7057ff --force',
      { cwd, stdio: "pipe" },
    );
    execSync(
      'gh label create "ralphai:in-progress" --description "Ralphai is working on this issue" --color fbca04 --force',
      { cwd, stdio: "pipe" },
    );
    return { success: true };
  } catch {
    return {
      success: false,
      error:
        "Could not create labels. Create them manually:\n" +
        '  gh label create ralphai --description "Ralphai picks up this issue" --color 7057ff --force\n' +
        '  gh label create "ralphai:in-progress" --description "Ralphai is working on this issue" --color fbca04 --force',
    };
  }
}

// ---------------------------------------------------------------------------
// Scaffold logic
// ---------------------------------------------------------------------------

function scaffold(
  answers: WizardAnswers,
  cwd: string,
  opts?: { shared?: boolean },
): void {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(__dir, "..", "templates", "ralphai");

  const ralphaiDir = join(cwd, ".ralphai");

  // Create .ralphai/ directory
  mkdirSync(ralphaiDir, { recursive: true });

  // Copy docs from templates
  copyFileSync(join(templatesDir, "README.md"), join(ralphaiDir, "README.md"));
  copyFileSync(
    join(templatesDir, "PLANNING.md"),
    join(ralphaiDir, "PLANNING.md"),
  );

  // Copy plan template guides
  const plansDir = join(ralphaiDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  for (const guide of ["feature.md", "bugfix.md", "refactor.md"]) {
    copyFileSync(join(templatesDir, "plans", guide), join(plansDir, guide));
  }

  // Generate config (JSON format) — all 17 keys with explicit defaults
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
    turns: answers.turns ?? 5,
    mode: answers.mode ?? "branch",
    autoCommit: answers.autoCommit ?? false,
    turnTimeout: 0,
    promptMode: "auto",
    continuous: false,
    issueSource: answers.issueSource ?? "none",
    issueLabel: "ralphai",
    issueInProgressLabel: "ralphai:in-progress",
    issueRepo: "",
    issueCommentProgress: true,
  };

  // Conditionally include workspaces to keep config clean for single-project repos
  if (answers.workspaces && Object.keys(answers.workspaces).length > 0) {
    configObj.workspaces = answers.workspaces;
  }

  const config = JSON.stringify(configObj, null, 2) + "\n";

  writeFileSync(join(cwd, "ralphai.json"), config);

  // Create pipeline subdirectories (no .gitkeep — .ralphai/ is fully gitignored)
  for (const subdir of ["backlog", "parked", "in-progress", "out"]) {
    mkdirSync(join(ralphaiDir, "pipeline", subdir), { recursive: true });
  }

  // Write sample plan if requested
  const samplePlanPath = join(
    ralphaiDir,
    "pipeline",
    "backlog",
    "hello-ralphai.md",
  );
  const samplePlanCreated = answers.createSamplePlan === true;
  if (samplePlanCreated && !existsSync(samplePlanPath)) {
    const samplePlanContent = `# Plan: Hello Ralphai

> A tiny first plan to verify the full Ralphai loop — init, run, commit.
> No build tools or language assumptions; works in any repository.

## Background

This plan was auto-generated by \`ralphai init\` so you can try the full
pipeline immediately. It creates a single file and verifies the result.

## Acceptance Criteria

- [ ] A file named \`hello-ralphai.txt\` exists in the repository root
- [ ] The file contains a greeting message
- [ ] The file mentions it was generated by Ralphai
- [ ] The change is committed with a conventional commit message

## Implementation Tasks

### Task 1: Create hello-ralphai.txt

**File:** \`hello-ralphai.txt\` (new file at repo root)

**What:**

Create a file called \`hello-ralphai.txt\` in the repository root with:
- A friendly greeting (e.g. "Hello from Ralphai!")
- A short note that this file was generated by Ralphai as a sample task
- The current date
`;
    writeFileSync(samplePlanPath, samplePlanContent);
  }

  // Create .ralphai/LEARNINGS.md — Ralphai-specific learnings (gitignored, local-only)
  const learningsContent = `# Ralphai Learnings

Mistakes and lessons learned during autonomous runs. This file is **gitignored** —
Ralphai reads and writes it automatically. Review periodically and promote useful
entries to \`AGENTS.md\` or skill docs when they have lasting value.

## Format

Each entry should include:

- **Date**: When the mistake was made
- **What went wrong**: Brief description of the error
- **Root cause**: Why it happened
- **Fix / Prevention**: How to avoid it in the future

---

<!-- Entries are added automatically by Ralphai during autonomous runs -->
`;
  writeFileSync(join(ralphaiDir, "LEARNINGS.md"), learningsContent);

  // Update or create AGENTS.md with a Ralphai section
  const agentsMdSection = `## Ralphai

This project uses [Ralphai](https://github.com/mfaux/ralphai) for autonomous task execution.
Plan files go in \`.ralphai/pipeline/backlog/\`. See \`.ralphai/PLANNING.md\` for
the plan writing guide.
`;

  let agentsMdAction: "created" | "updated" | null = null;
  if (answers.updateAgentsMd) {
    const agentsMdPath = join(cwd, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
      const content = readFileSync(agentsMdPath, "utf-8");
      if (!/^## Ralphai\b/m.test(content)) {
        writeFileSync(
          agentsMdPath,
          content.trimEnd() + "\n\n" + agentsMdSection,
        );
        agentsMdAction = "updated";
      }
    } else {
      const header = `# Agent Instructions

Project-specific guidance for AI coding agents working in this codebase.

`;
      writeFileSync(agentsMdPath, header + agentsMdSection);
      agentsMdAction = "created";
    }
  }

  // Ensure .ralphai and ralphai.json are gitignored in the project's root .gitignore.
  // Use ".ralphai" (no trailing slash) so it matches both directories and
  // symlinks — worktrees create a .ralphai symlink that ".ralphai/" won't match.
  // ralphai.json is gitignored by default — each developer's config is personal.
  // Teams that want shared config can remove ralphai.json from .gitignore.
  const rootGitignore = join(cwd, ".gitignore");
  const gitignoreEntry = ".ralphai";
  const gitignoreEntryLegacy = ".ralphai/";
  const shouldIgnoreConfig = !opts?.shared;
  if (existsSync(rootGitignore)) {
    const content = readFileSync(rootGitignore, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    let updated = content;
    if (
      !lines.some(
        (line) => line === gitignoreEntry || line === gitignoreEntryLegacy,
      )
    ) {
      updated = updated.trimEnd() + "\n\n# ralphai local state\n.ralphai\n";
    }
    if (shouldIgnoreConfig && !lines.some((line) => line === "ralphai.json")) {
      // Append on a new line if .ralphai block was just added, otherwise start a new block
      if (updated !== content) {
        updated = updated.trimEnd() + "\nralphai.json\n";
      } else {
        updated =
          updated.trimEnd() +
          "\n\n# ralphai local state\n.ralphai\nralphai.json\n";
      }
    }
    if (updated !== content) {
      writeFileSync(rootGitignore, updated);
    }
  } else {
    const ignoreLines = ["# ralphai local state", ".ralphai"];
    if (shouldIgnoreConfig) ignoreLines.push("ralphai.json");
    writeFileSync(rootGitignore, ignoreLines.join("\n") + "\n");
  }

  // Create GitHub labels if issues integration is enabled
  let labelResult: LabelResult | null = null;
  if (answers.issueSource === "github") {
    labelResult = ensureGitHubLabels(cwd);
  }

  // Print success output
  console.log(`${TEXT}Ralphai initialized${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(
    `  ralphai.json               ${DIM}Configuration (edit to customize)${RESET}`,
  );
  console.log(`  .ralphai/README.md         ${DIM}Operational docs${RESET}`);
  console.log(`  .ralphai/PLANNING.md       ${DIM}How to write plans${RESET}`);
  console.log(
    `  .ralphai/plans/            ${DIM}Plan guides (feature, bugfix, refactor)${RESET}`,
  );
  console.log(
    `  .ralphai/LEARNINGS.md      ${DIM}Ralphai-specific learnings${RESET}`,
  );
  console.log(`  .ralphai/pipeline/backlog/ ${DIM}Queue plans here${RESET}`);
  if (samplePlanCreated) {
    console.log(
      `  hello-ralphai.md           ${DIM}Sample plan (ready to run)${RESET}`,
    );
  }
  console.log(
    `  .ralphai/pipeline/parked/  ${DIM}Park unready plans here${RESET}`,
  );
  if (labelResult) {
    if (labelResult.success) {
      console.log(
        `  GitHub labels              ${DIM}Created "ralphai" and "ralphai:in-progress" labels${RESET}`,
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
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  if (samplePlanCreated) {
    console.log(
      `  1. A sample plan is ready in ${TEXT}.ralphai/pipeline/backlog/${RESET}`,
    );
    console.log(`  2. Run the plan in an isolated worktree:`);
  } else {
    console.log(
      `  1. Write a plan in ${TEXT}.ralphai/pipeline/backlog/${RESET} (see ${TEXT}PLANNING.md${RESET})`,
    );
    console.log(`  2. Run it in an isolated worktree:`);
  }
  console.log(`       ${TEXT}$ ralphai worktree${RESET}`);
  console.log(`     ${DIM}Or: switch to a branch and run directly:${RESET}`);
  console.log(`       ${TEXT}$ ralphai run${RESET}`);
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
  const ralphaiRoot = resolveRalphaiDir(cwd);
  if (!ralphaiRoot) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const ralphaiDir = join(ralphaiRoot, ".ralphai");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");

  if (!existsSync(inProgressDir)) {
    console.log("Nothing to reset — no in-progress directory.");
    return;
  }

  const planSlugs = listPlanFolders(inProgressDir);
  const planFiles = planSlugs.map((slug) => `${slug}.md`);

  // Check for worktrees to clean
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(ralphaiRoot);
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

  // 1. Extract plan files from in-progress slug-folders back to backlog as flat files
  for (const slug of planSlugs) {
    const src = join(inProgressDir, slug);
    const planFile = join(src, `${slug}.md`);
    const dest = join(backlogDir, `${slug}.md`);
    mkdirSync(backlogDir, { recursive: true });
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
      execSync("git worktree prune", { cwd: ralphaiRoot, stdio: "pipe" });
    } catch {
      // Not critical
    }

    for (const wt of worktrees) {
      try {
        // Use --force because the worktree may have uncommitted changes
        // from interrupted agent work.
        execSync(`git worktree remove --force "${wt.path}"`, {
          cwd: ralphaiRoot,
          stdio: "pipe",
        });
        // Force-delete branch (-D) because ralphai/* branches are typically
        // not merged to main yet. Non-force -d would silently fail, leaving
        // stale branches that cause dirty-state errors on the next run.
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd: ralphaiRoot,
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
// purge — delete all archived artifacts from pipeline/out/
// ---------------------------------------------------------------------------

async function runRalphaiPurge(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const ralphaiRoot = resolveRalphaiDir(cwd);
  if (!ralphaiRoot) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const outDir = join(ralphaiRoot, ".ralphai", "pipeline", "out");

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
  console.log(`${TEXT}Commands:${RESET}`);
  console.log(
    `  ${TEXT}init${RESET}        ${DIM}Set up Ralphai in your project (interactive wizard)${RESET}`,
  );
  console.log(
    `  ${TEXT}run${RESET}         ${DIM}Start the Ralphai task runner${RESET}`,
  );
  console.log(
    `  ${TEXT}worktree${RESET}    ${DIM}Run in an isolated git worktree${RESET}`,
  );
  console.log(
    `  ${TEXT}status${RESET}      ${DIM}Show pipeline and worktree status${RESET}`,
  );
  console.log(
    `  ${TEXT}reset${RESET}       ${DIM}Move in-progress plans back to backlog and clean up${RESET}`,
  );
  console.log(
    `  ${TEXT}purge${RESET}       ${DIM}Delete archived artifacts from pipeline/out/${RESET}`,
  );
  console.log(
    `  ${TEXT}update${RESET}      ${DIM}Update ralphai to the latest (or specified) version${RESET}`,
  );
  console.log(
    `  ${TEXT}teardown${RESET}    ${DIM}Remove Ralphai from your project${RESET}`,
  );
  console.log(
    `  ${TEXT}doctor${RESET}      ${DIM}Check your ralphai setup for problems${RESET}`,
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
  const cwd = options.targetDir ? resolve(options.targetDir) : process.cwd();
  const helpRequested = args.includes("--help") || args.includes("-h");

  // Subcommands that reject unknown flags (run/worktree pass through to bash)
  const STRICT_SUBCOMMANDS = new Set([
    "init",
    "status",
    "reset",
    "purge",
    "update",
    "teardown",
    "doctor",
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
    case "teardown":
      if (helpRequested) {
        showTeardownHelp();
        return;
      }
      await teardownRalphai(options, cwd);
      break;
    case "run":
      await runRalphaiRunner(options, cwd);
      break;
    case "worktree":
      await runRalphaiWorktree(options, cwd);
      break;
    case "status":
      if (helpRequested) {
        showStatusHelp();
        return;
      }
      runRalphaiStatus(cwd);
      break;
    case "reset":
      if (helpRequested) {
        showResetHelp();
        return;
      }
      await runRalphaiReset(options, cwd);
      break;
    case "purge":
      if (helpRequested) {
        showPurgeHelp();
        return;
      }
      await runRalphaiPurge(options, cwd);
      break;
    case "doctor":
      if (helpRequested) {
        showDoctorHelp();
        return;
      }
      runRalphaiDoctor(cwd);
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
 * Resolve the directory containing `.ralphai/`. Returns `cwd` if it has
 * `.ralphai/` directly, falls back to the main worktree root when running
 * inside a git worktree, or `null` if `.ralphai/` cannot be found.
 */
function resolveRalphaiDir(cwd: string): string | null {
  // Direct check first — covers the common (non-worktree) case
  if (existsSync(join(cwd, ".ralphai"))) {
    return cwd;
  }
  // Worktree fallback: resolve main worktree root
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    // --git-common-dir may return a relative path; anchor to cwd
    const mainRoot = resolve(cwd, commonDir, "..");
    if (mainRoot !== cwd && existsSync(join(mainRoot, ".ralphai"))) {
      return mainRoot;
    }
  } catch {
    // Not in a git repo, or git not available
  }
  return null;
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
  // Block init inside a git worktree — .ralphai/ must live in the main repo
  if (isGitWorktree(cwd)) {
    console.error(
      `Cannot initialize ralphai inside a git worktree.\n` +
        `${DIM}Run ${TEXT}ralphai init${DIM} in the main repository instead.${RESET}`,
    );
    process.exit(1);
  }

  // Check if .ralphai/ already exists
  if (existsSync(join(cwd, ".ralphai"))) {
    if (options.force) {
      // --force: remove everything and re-scaffold from scratch
      if (!options.yes) {
        clack.intro("Force re-scaffolding Ralphai");

        const confirmed = await clack.confirm({
          message:
            "This will DELETE .ralphai/ entirely and re-scaffold from scratch. " +
            "Your config and any plan files will be LOST. Continue?",
        });

        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel("Force re-scaffold cancelled.");
          return;
        }
      }

      rmSync(join(cwd, ".ralphai"), { recursive: true, force: true });
      // Fall through to normal scaffold below
    } else {
      console.error(
        `Ralphai is already set up in this directory (.ralphai/ exists).\n` +
          `${DIM}Use ${TEXT}ralphai init --force${DIM} to re-scaffold from scratch.${RESET}`,
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

    answers = {
      agentCommand,
      baseBranch: detectBaseBranch(cwd),
      feedbackCommands: detectedFeedbackStr,
      turns: 5,
      mode: "branch",
      autoCommit: false,
      issueSource: "none",
      createSamplePlan: true,
      updateAgentsMd: !agentsMdHasSection,
    };

    // Print detection summary so users can verify auto-detected values
    const feedbackDisplay = answers.feedbackCommands.trim() || "(none)";
    console.log(`${DIM}Detected:${RESET}`);
    console.log(
      `  ${DIM}Agent:${RESET}     ${TEXT}${answers.agentCommand}${RESET}`,
    );
    console.log(
      `  ${DIM}Branch:${RESET}    ${TEXT}${answers.baseBranch}${RESET}`,
    );
    console.log(`  ${DIM}Feedback:${RESET}  ${TEXT}${feedbackDisplay}${RESET}`);
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
        "Feedback commands will be auto-filtered by scope at runtime. Add custom overrides to the workspaces key in ralphai.json if needed.",
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
      "No build/test/lint scripts detected. Your agent won't get feedback between turns. Add feedbackCommands to ralphai.json.";
    if (options.yes) {
      console.log(`${TEXT}Warning:${RESET} ${DIM}${msg}${RESET}`);
    } else {
      clack.log.warn(msg);
    }
  }

  scaffold(answers, cwd, { shared: options.shared });
}

// ---------------------------------------------------------------------------
// Worktree subcommand
// ---------------------------------------------------------------------------

interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

interface SelectedWorktreePlan {
  planFile: string;
  slug: string;
  source: "backlog" | "in-progress";
}

interface Receipt {
  started_at: string;
  source: "main" | "worktree";
  worktree_path?: string;
  branch: string;
  slug: string;
  plan_file?: string;
  turns_budget: number;
  turns_completed: number;
  tasks_completed: number;
  outcome?: string;
}

function parseReceipt(filePath: string): Receipt | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const fields: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return {
    started_at: fields.started_at ?? "",
    source: (fields.source as "main" | "worktree") ?? "main",
    worktree_path: fields.worktree_path,
    branch: fields.branch ?? "",
    slug: fields.slug ?? "",
    plan_file: fields.plan_file,
    turns_budget: parseInt(fields.turns_budget ?? "0", 10),
    turns_completed: parseInt(fields.turns_completed ?? "0", 10),
    tasks_completed: parseInt(fields.tasks_completed ?? "0", 10),
    outcome: fields.outcome,
  };
}

/**
 * Check receipt for cross-source conflicts. Called from runRalphaiRunner
 * to provide early TypeScript-level blocking before the bash runner runs.
 * Returns true if the run should proceed, false (with error output) if blocked.
 */
function checkReceiptSource(ralphaiDir: string, isWorktree: boolean): boolean {
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
  if (!existsSync(inProgressDir)) return true;

  const planSlugs = listPlanFolders(inProgressDir);
  for (const slug of planSlugs) {
    const receiptPath = join(inProgressDir, slug, "receipt.txt");
    const receipt = parseReceipt(receiptPath);
    if (!receipt) continue;

    if (receipt.source === "worktree" && !isWorktree) {
      console.error();
      console.error(`Plan "${receipt.slug}" is running in a worktree.`);
      console.error();
      console.error(`  Worktree: ${receipt.worktree_path ?? "unknown"}`);
      console.error(`  Branch:   ${receipt.branch || "unknown"}`);
      console.error(`  Started:  ${receipt.started_at || "unknown"}`);
      console.error();
      console.error(`  To resume:  ralphai worktree`);
      console.error(`  To discard: ralphai worktree clean`);
      return false;
    }

    if (receipt.source === "main" && isWorktree) {
      console.error();
      console.error(
        `Plan "${receipt.slug}" is already running in the main repository.`,
      );
      console.error();
      console.error(`  Branch:  ${receipt.branch || "unknown"}`);
      console.error(`  Started: ${receipt.started_at || "unknown"}`);
      console.error();
      console.error(
        `  Finish or interrupt the main-repo run first, then retry.`,
      );
      return false;
    }
  }
  return true;
}

function parseWorktreeList(output: string): WorktreeEntry[] {
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

function selectPlanForWorktree(
  ralphaiDir: string,
  specificPlan?: string,
  activeWorktrees: WorktreeEntry[] = [],
): SelectedWorktreePlan | null {
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");

  // Build set of slugs that already have an active worktree
  const activeSlugs = new Set(
    activeWorktrees.map((wt) => wt.branch.replace("ralphai/", "")),
  );

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
      `Multiple unattended in-progress plans. Use ${TEXT}ralphai worktree --plan=<file>${RESET} to choose which one to resume.`,
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
      `Multiple in-progress plans with active worktrees. Use ${TEXT}ralphai worktree --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of attendedPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  console.error(
    `No plans in backlog. Add a plan to .ralphai/pipeline/backlog/ first.`,
  );
  return null;
}

function listRalphaiWorktrees(cwd: string): WorktreeEntry[] {
  const output = execSync("git worktree list --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return parseWorktreeList(output).filter((wt) =>
    wt.branch.startsWith("ralphai/"),
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
    `  ${TEXT}--force${RESET}                ${DIM}Re-scaffold from scratch (deletes existing .ralphai/)${RESET}`,
  );
  console.log(
    `  ${TEXT}--shared${RESET}               ${DIM}Track ralphai.json in git (for team-shared config)${RESET}`,
  );
  console.log(
    `  ${TEXT}--agent-command=${RESET}<cmd>   ${DIM}Set the agent command (default: opencode run --agent build)${RESET}`,
  );
}

function showStatusHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai status`);
  console.log();
  console.log(`${DIM}Show pipeline and worktree status.${RESET}`);
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

function showPurgeHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai purge [options]`);
  console.log();
  console.log(
    `${DIM}Delete all archived plans, progress files, and receipts from pipeline/out/.${RESET}`,
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

function showTeardownHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai teardown [options]`);
  console.log();
  console.log(`${DIM}Remove Ralphai from your project.${RESET}`);
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--yes, -y${RESET}   ${DIM}Skip confirmation prompt${RESET}`,
  );
}

function showDoctorHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai doctor`);
  console.log();
  console.log(
    `${DIM}Run diagnostic checks on your ralphai setup and report problems.${RESET}`,
  );
}

function showWorktreeHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai worktree [command] [options]`);
  console.log();
  console.log(`${TEXT}Commands:${RESET}`);
  console.log(
    `  ${DIM}(default)${RESET}   ${DIM}Create or reuse a worktree and run a plan in PR mode${RESET}`,
  );
  console.log(
    `  ${TEXT}list${RESET}        ${DIM}Show active ralphai-managed worktrees${RESET}`,
  );
  console.log(
    `  ${TEXT}clean${RESET}       ${DIM}Remove completed/orphaned worktrees${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--plan=${RESET}<file>   ${DIM}Target a specific backlog plan (default: auto-detect)${RESET}`,
  );
  console.log(
    `  ${TEXT}--dir=${RESET}<path>    ${DIM}Worktree directory (default: ../.ralphai-worktrees/<slug>)${RESET}`,
  );
  console.log();
  console.log(
    `${DIM}All other options are forwarded to the task runner (for example, --turns=<n>, --resume, --feedback-commands=...).${RESET}`,
  );
}

/**
 * List subdirectory names in `dir`.
 */
function listPlanFolders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function planPathForSlug(dir: string, slug: string): string {
  return join(dir, slug, `${slug}.md`);
}

/**
 * List plan slugs in `dir`.
 * - Slug-folder plans (`<slug>/<slug>.md`): used by in-progress and out.
 * - Flat `.md` files (`<slug>.md`): used by backlog.
 * Pass `flatOnly: true` for backlog to skip slug-folder scanning.
 */
function listPlanSlugs(dir: string, flatOnly = false): string[] {
  if (!existsSync(dir)) return [];
  const seen = new Set<string>();
  const slugs: string[] = [];

  // Slug-folder plans: <dir>/<slug>/<slug>.md (in-progress, out)
  if (!flatOnly) {
    for (const folder of listPlanFolders(dir)) {
      if (existsSync(planPathForSlug(dir, folder))) {
        seen.add(folder);
        slugs.push(folder);
      }
    }
  }

  // Flat files: <dir>/<slug>.md (backlog)
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const slug = entry.name.replace(/\.md$/, "");
      if (!seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    }
  } catch {
    // ignore read errors
  }

  return slugs;
}

function listPlanFiles(dir: string, flatOnly = false): string[] {
  return listPlanSlugs(dir, flatOnly).map((slug) => `${slug}.md`);
}

/**
 * Resolve the path to a plan file for a given slug in `dir`.
 * Checks slug-folder (`<dir>/<slug>/<slug>.md`) for in-progress/out,
 * then flat file (`<dir>/<slug>.md`) for backlog.
 * Returns the path if found, null otherwise.
 */
function resolvePlanPath(dir: string, slug: string): string | null {
  const folderPath = planPathForSlug(dir, slug);
  if (existsSync(folderPath)) return folderPath;
  const flatPath = join(dir, `${slug}.md`);
  if (existsSync(flatPath)) return flatPath;
  return null;
}

function planExistsForSlug(dir: string, slug: string): boolean {
  return resolvePlanPath(dir, slug) !== null;
}

function listWorktrees(cwd: string): void {
  const worktrees = listRalphaiWorktrees(cwd);

  if (worktrees.length === 0) {
    console.log("No active ralphai worktrees.");
    return;
  }

  console.log("Active ralphai worktrees:\n");
  for (const wt of worktrees) {
    const slug = wt.branch.replace("ralphai/", "");
    const ralphaiDir = join(cwd, ".ralphai");
    const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
    const hasActivePlan = planExistsForSlug(inProgressDir, slug);
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

  const ralphaiDir = join(cwd, ".ralphai");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
  const archiveDir = join(ralphaiDir, "pipeline", "out");
  let cleaned = 0;

  for (const wt of worktrees) {
    const slug = wt.branch.replace("ralphai/", "");
    const hasActivePlan = planExistsForSlug(inProgressDir, slug);

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

        // Archive receipt if one exists for this slug
        const planDir = join(inProgressDir, slug);
        const receiptFile = join(planDir, "receipt.txt");
        if (existsSync(receiptFile)) {
          const destDir = join(archiveDir, slug);
          mkdirSync(destDir, { recursive: true });
          const dest = join(destDir, "receipt.txt");
          renameSync(receiptFile, dest);
          console.log(`  Archived receipt: ${slug}/receipt.txt`);
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

function checkRalphaiDirExists(cwd: string): DoctorCheckResult {
  if (existsSync(join(cwd, ".ralphai"))) {
    return { status: "pass", message: ".ralphai/ initialized" };
  }
  return { status: "fail", message: ".ralphai/ not found — run ralphai init" };
}

function checkConfigValid(cwd: string): DoctorCheckResult {
  const configPath = join(cwd, "ralphai.json");
  if (!existsSync(configPath)) {
    return {
      status: "fail",
      message: "ralphai.json not found",
    };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const keys = Object.keys(config);
    return {
      status: "pass",
      message: `ralphai.json valid (${keys.length} keys)`,
    };
  } catch {
    return {
      status: "fail",
      message: "ralphai.json is not valid JSON",
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
  const configPath = join(cwd, "ralphai.json");
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
  const configPath = join(cwd, "ralphai.json");
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
  const configPath = join(cwd, "ralphai.json");
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
        timeout: 60000,
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
  const configPath = join(cwd, "ralphai.json");
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
          timeout: 60000,
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
  const backlogDir = join(cwd, ".ralphai", "pipeline", "backlog");
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
  const inProgressDir = join(cwd, ".ralphai", "pipeline", "in-progress");
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

function checkWorktreeSymlink(cwd: string): DoctorCheckResult {
  if (!isGitWorktree(cwd)) {
    return {
      status: "pass",
      message: "not a worktree (symlink check skipped)",
    };
  }
  const ralphaiPath = join(cwd, ".ralphai");
  if (!existsSync(ralphaiPath)) {
    return { status: "pass", message: "worktree: no local .ralphai/ (ok)" };
  }
  try {
    if (lstatSync(ralphaiPath).isSymbolicLink()) {
      return { status: "pass", message: "worktree: .ralphai/ is a symlink" };
    }
  } catch {
    return { status: "pass", message: "worktree: .ralphai/ check skipped" };
  }
  return {
    status: "warn",
    message:
      ".ralphai/ is a directory in this worktree (not a symlink) — local plans will be ignored",
  };
}

function runRalphaiDoctor(cwd: string): void {
  const results: DoctorCheckResult[] = [];

  // 1. .ralphai/ exists
  results.push(checkRalphaiDirExists(cwd));

  // 2. ralphai.json valid
  results.push(checkConfigValid(cwd));

  // 3. Git repo detected
  results.push(checkGitRepo(cwd));

  // 3b. Worktree .ralphai/ symlink check (only if git repo detected)
  if (results[2]!.status !== "fail") {
    results.push(checkWorktreeSymlink(cwd));
  }

  // 4. Working tree clean (only if git repo detected)
  if (results[2]!.status !== "fail") {
    results.push(checkWorkingTreeClean(cwd));
  }

  // 5. Base branch exists (only if git repo detected)
  if (results[2]!.status !== "fail") {
    results.push(checkBaseBranchExists(cwd));
  }

  // 6. Agent command in PATH (only if config exists)
  if (results[1]!.status !== "fail") {
    results.push(checkAgentCommand(cwd));
  }

  // 7. Feedback commands (only if config exists)
  if (results[1]!.status !== "fail") {
    results.push(...checkFeedbackCommands(cwd));
  }

  // 7b. Workspace feedback commands (only if config exists)
  if (results[1]!.status !== "fail") {
    results.push(...checkWorkspaceFeedbackCommands(cwd));
  }

  // 8. Backlog has plans (only if .ralphai/ exists)
  if (results[0]!.status !== "fail") {
    results.push(checkBacklogHasPlans(cwd));
  }

  // 9. No orphaned receipts (only if .ralphai/ exists)
  if (results[0]!.status !== "fail") {
    results.push(checkOrphanedReceipts(cwd));
  }

  // --- Print report ---
  console.log();
  console.log(`${TEXT}ralphai doctor${RESET}`);
  console.log();

  const statusIcons: Record<DoctorCheckResult["status"], string> = {
    pass: "\u2713",
    fail: "\u2717",
    warn: "\u26A0",
  };

  for (const result of results) {
    const icon = statusIcons[result.status];
    console.log(`  ${icon} ${DIM}${result.message}${RESET}`);
  }

  const failures = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warn").length;

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

/**
 * Count total tasks in a plan file by counting `### Task N:` headings.
 */
function countPlanTasks(planPath: string): number {
  if (!existsSync(planPath)) return 0;
  const content = readFileSync(planPath, "utf-8");
  const matches = content.match(/^### Task \d+/gm);
  return matches ? matches.length : 0;
}

/**
 * Count completed tasks in a progress file. Handles two patterns:
 * 1. Individual: `### Task N:` followed by `**Status:** Complete`
 * 2. Batch: `### ... Tasks X–Y:` or `### ... Tasks X-Y:` headings
 */
function countCompletedTasks(progressPath: string): number {
  if (!existsSync(progressPath)) return 0;
  const content = readFileSync(progressPath, "utf-8");

  // Count individual `**Status:** Complete` entries
  const completeMatches = content.match(/\*\*Status:\*\*\s*Complete/gi);
  let count = completeMatches ? completeMatches.length : 0;

  // Count batch entries: `### ... Tasks X–Y` or `### ... Tasks X-Y` headings only
  const batchMatches = content.matchAll(
    /^### .*Tasks?\s+(\d+)\s*[–-]\s*(\d+)/gim,
  );
  for (const match of batchMatches) {
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    if (end > start) {
      count += end - start + 1;
    }
  }

  return count;
}

/**
 * Extract depends-on filenames from YAML frontmatter.
 * Supports: `depends-on: [a.md, b.md]` (inline array).
 */
function extractDependsOn(planPath: string): string[] {
  if (!existsSync(planPath)) return [];
  const content = readFileSync(planPath, "utf-8");
  if (!content.startsWith("---\n")) return [];

  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return [];
  const frontmatter = content.slice(4, endIdx);

  const match = frontmatter.match(/^\s*depends-on:\s*\[([^\]]*)\]/m);
  if (!match) return [];

  return match[1]!
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

// extractScope is imported from ./frontmatter.ts (re-exported for backward compat)
export { extractScope } from "./frontmatter.ts";

function runRalphaiStatus(cwd: string): void {
  // Resolve .ralphai/ — works from main repo or worktree
  const ralphaiRoot = resolveRalphaiDir(cwd);
  if (!ralphaiRoot) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const ralphaiDir = join(ralphaiRoot, ".ralphai");
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
  const archiveDir = join(ralphaiDir, "pipeline", "out");

  // --- Collect data ---
  const backlogPlans = listPlanFiles(backlogDir, true);

  const inProgressPlans = listPlanFiles(inProgressDir);
  const receiptFiles = listPlanFolders(inProgressDir).filter((slug) =>
    existsSync(join(inProgressDir, slug, "receipt.txt")),
  );

  const completedSlugs = new Set(listPlanSlugs(archiveDir));

  // Build receipt lookup: plan filename → Receipt
  const receiptsByPlan = new Map<string, Receipt>();
  for (const slug of receiptFiles) {
    const receipt = parseReceipt(join(inProgressDir, slug, "receipt.txt"));
    if (receipt) {
      const planFile = receipt.plan_file || `${slug}.md`;
      receiptsByPlan.set(planFile, receipt);
    }
  }

  // --- Pipeline section ---
  console.log();
  console.log(`${TEXT}Pipeline${RESET}`);

  // Backlog
  console.log();
  console.log(
    `  ${TEXT}Backlog${RESET}      ${DIM}${backlogPlans.length} plan${backlogPlans.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of backlogPlans) {
    let suffix = "";
    const slug = plan.replace(/\.md$/, "");
    const planPath = resolvePlanPath(backlogDir, slug);
    const deps = planPath ? extractDependsOn(planPath) : [];
    const scope = planPath ? extractScope(planPath) : "";
    const suffixParts: string[] = [];
    if (scope) {
      suffixParts.push(`scope: ${scope}`);
    }
    if (deps.length > 0) {
      suffixParts.push(`waiting on ${deps.join(", ")}`);
    }
    if (suffixParts.length > 0) {
      suffix = `${DIM}${suffixParts.join("  ")}${RESET}`;
    }
    console.log(`    ${DIM}${plan}${RESET}${suffix ? "  " + suffix : ""}`);
  }

  // In Progress
  console.log();
  console.log(
    `  ${TEXT}In Progress${RESET}  ${DIM}${inProgressPlans.length} plan${inProgressPlans.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of inProgressPlans) {
    const receipt = receiptsByPlan.get(plan);
    const parts: string[] = [];

    // Scope info
    const slug = plan.replace(/\.md$/, "");
    const planFilePath = join(inProgressDir, slug, plan);
    const scope = extractScope(planFilePath);
    if (scope) {
      parts.push(`scope: ${scope}`);
    }

    // Task progress
    const totalTasks = countPlanTasks(planFilePath);
    if (totalTasks > 0) {
      const completed = receipt?.tasks_completed ?? 0;
      parts.push(`${completed} of ${totalTasks} tasks`);
    }

    // Turns used / budget
    if (receipt) {
      if (receipt.turns_budget > 0) {
        parts.push(
          `turn ${receipt.turns_completed} of ${receipt.turns_budget}`,
        );
      } else if (receipt.turns_budget === 0) {
        parts.push("unlimited turns");
      }
    }

    // Worktree info from receipt
    if (receipt?.source === "worktree") {
      parts.push(`worktree: ${slug}`);
    }

    // Outcome / status tag
    if (receipt?.outcome) {
      parts.push(`[${receipt.outcome}]`);
    } else {
      parts.push("[in progress]");
    }

    const suffix =
      parts.length > 0 ? `${DIM}${parts.join("    ")}${RESET}` : "";
    console.log(`    ${DIM}${plan}${RESET}${suffix ? "  " + suffix : ""}`);
  }

  // Completed
  console.log();
  console.log(
    `  ${TEXT}Completed${RESET}    ${DIM}${completedSlugs.size} plan${completedSlugs.size !== 1 ? "s" : ""}${RESET}`,
  );
  for (const slug of [...completedSlugs].sort()) {
    console.log(`    ${DIM}${slug}.md${RESET}`);
  }

  // --- Worktrees section ---
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(ralphaiRoot);
  } catch {
    // Not in a git repo or git not available
  }

  if (worktrees.length > 0) {
    console.log();
    console.log(`${TEXT}Worktrees${RESET}`);
    console.log();
    for (const wt of worktrees) {
      const slug = wt.branch.replace("ralphai/", "");
      const hasActivePlan = planExistsForSlug(inProgressDir, slug);
      const state = hasActivePlan ? "in-progress" : "idle";
      console.log(
        `  ${DIM}${wt.branch}${RESET}  ${DIM}${wt.path}${RESET}  ${DIM}[${state}]${RESET}`,
      );
    }
  }

  // --- Problems section ---
  const problems: string[] = [];

  // Orphaned receipts: receipt exists but no matching plan file
  for (const [planFile, receipt] of receiptsByPlan) {
    const slug = planFile.replace(/\.md$/, "");
    const planPath = join(inProgressDir, slug, planFile);
    if (!existsSync(planPath)) {
      problems.push(
        `Orphaned receipt: ${slug}/receipt.txt (no matching plan file)`,
      );
    }
  }

  // Stale worktree entries: worktree listed but directory missing
  for (const wt of worktrees) {
    if (!existsSync(wt.path)) {
      problems.push(`Missing worktree directory: ${wt.path} (${wt.branch})`);
    }
  }

  if (problems.length > 0) {
    console.log();
    console.log(`${TEXT}Problems${RESET}`);
    console.log();
    for (const p of problems) {
      console.log(`  ${DIM}${p}${RESET}`);
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
    showWorktreeHelp();
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
      break; // fall through to worktree run logic below
  }

  // --- worktree run ---

  // Dry-run: skip all worktree/branch/symlink creation and run the
  // bash runner from the main repo so it can print the preview.
  const isDryRun =
    wtOpts.runArgs.includes("--dry-run") || wtOpts.runArgs.includes("-n");
  if (isDryRun) {
    const dryRunOptions: RalphaiOptions = {
      ...options,
      subcommand: "run",
      runArgs: ["--pr", ...wtOpts.runArgs],
    };
    try {
      await runRalphaiRunner(dryRunOptions, cwd);
    } catch {
      // runRalphaiRunner calls process.exit() internally
    }
    return;
  }

  // Guard: must be in main repo, not a worktree
  if (isGitWorktree(cwd)) {
    console.error(`'ralphai worktree' must be run from the main repository.`);
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  // Guard: .ralphai must exist
  if (!existsSync(join(cwd, ".ralphai"))) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Guard: repo must have at least one commit (git worktree requires a valid ref)
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
  } catch {
    console.error(
      `This repository has no commits yet. Git worktrees require at least one commit.`,
    );
    console.error(
      `\n  ${TEXT}git add . && git commit -m "initial commit"${RESET}`,
    );
    console.error(`\nThen re-run ${TEXT}ralphai worktree${RESET}.`);
    process.exit(1);
  }

  // Select plan (in-progress first, then backlog)
  const activeWorktrees = listRalphaiWorktrees(cwd);
  const plan = selectPlanForWorktree(
    join(cwd, ".ralphai"),
    wtOpts.plan,
    activeWorktrees,
  );
  if (!plan) process.exit(1);

  // Check receipt for cross-source conflicts: block if plan is running in main repo
  const receiptPath = join(
    cwd,
    ".ralphai",
    "pipeline",
    "in-progress",
    plan.slug,
    "receipt.txt",
  );
  const receipt = parseReceipt(receiptPath);
  if (receipt && receipt.source === "main") {
    console.error();
    console.error(
      `Plan "${plan.slug}" is already running in the main repository.`,
    );
    console.error();
    console.error(`  Branch:  ${receipt.branch || "unknown"}`);
    console.error(`  Started: ${receipt.started_at || "unknown"}`);
    console.error();
    console.error(`  Finish or interrupt the main-repo run first, then retry.`);
    process.exit(1);
  }

  // Determine base branch
  const baseBranch = detectBaseBranch(cwd);
  const branch = `ralphai/${plan.slug}`;
  const activeWorktree = activeWorktrees.find((wt) => wt.branch === branch);

  // Determine worktree directory
  const worktreeBase = wtOpts.dir
    ? resolve(wtOpts.dir)
    : join(cwd, "..", ".ralphai-worktrees");
  const worktreeDir = wtOpts.dir
    ? resolve(wtOpts.dir)
    : join(worktreeBase, plan.slug);
  if (!wtOpts.dir) {
    mkdirSync(worktreeBase, { recursive: true });
  }

  let resolvedWorktreeDir = worktreeDir;

  if (activeWorktree) {
    resolvedWorktreeDir = activeWorktree.path;
    console.log(`Reusing existing worktree: ${resolvedWorktreeDir}`);
    console.log(`Branch: ${branch}`);
    if (wtOpts.dir && resolvedWorktreeDir !== worktreeDir) {
      console.log(
        `${DIM}Ignoring --dir because branch ${branch} is already active at ${resolvedWorktreeDir}.${RESET}`,
      );
    }
  } else {
    // Clean up orphaned worktree directory: exists on disk but not tracked
    // by git (e.g. from a prior run that was interrupted or manually removed).
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

    if (branchExists) {
      console.log(`Recreating worktree: ${resolvedWorktreeDir}`);
      console.log(`Branch: ${branch}`);
      try {
        execSync(`git worktree add "${resolvedWorktreeDir}" "${branch}"`, {
          cwd,
          stdio: ["inherit", "pipe", "pipe"],
        });
      } catch (err: unknown) {
        const stderr = extractExecStderr(err);
        console.error(
          `${TEXT}Error:${RESET} Failed to attach existing branch '${branch}' to a worktree.`,
        );
        if (stderr) console.error(`  git: ${stderr}`);
        process.exit(1);
      }
    } else {
      console.log(`Creating worktree: ${resolvedWorktreeDir}`);
      console.log(`Branch: ${branch} (from ${baseBranch})`);
      try {
        execSync(
          `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`,
          { cwd, stdio: ["inherit", "pipe", "pipe"] },
        );
      } catch (err: unknown) {
        const stderr = extractExecStderr(err);
        console.error(`${TEXT}Error:${RESET} Failed to create worktree.`);
        if (stderr) console.error(`  git: ${stderr}`);
        process.exit(1);
      }
    }
  }

  // Symlink .ralphai/ from worktree → main repo so the agent can access
  // pipeline files as relative paths. Without this, agents with directory
  // sandboxing (OpenCode, Claude Code, Codex) reject reads/writes to the
  // main repo's .ralphai/ as "external directory" access.
  //
  // Since .ralphai/ is fully gitignored, `git worktree add` won't create
  // it in the worktree — we just need to add the symlink.
  const worktreeRalphaiLink = join(resolvedWorktreeDir, ".ralphai");
  if (!existsSync(worktreeRalphaiLink)) {
    symlinkSync(join(cwd, ".ralphai"), worktreeRalphaiLink);
  }

  // Symlink ralphai.json from worktree → main repo so config is available
  // even when ralphai.json is not committed (gitignored / untracked).
  // If committed, `git worktree add` already checked it out — skip.
  const worktreeConfigLink = join(resolvedWorktreeDir, "ralphai.json");
  if (
    !existsSync(worktreeConfigLink) &&
    existsSync(join(cwd, "ralphai.json"))
  ) {
    symlinkSync(join(cwd, "ralphai.json"), worktreeConfigLink);
  }

  // Spawn ralphai runner in the worktree
  console.log("Running ralphai in worktree...");
  const shouldResume =
    plan.source === "in-progress" || activeWorktree !== undefined;
  const hasResumeFlag =
    wtOpts.runArgs.includes("--resume") || wtOpts.runArgs.includes("-r");
  const runnerArgs = [
    "--pr",
    ...(shouldResume && !hasResumeFlag ? ["--resume"] : []),
    ...wtOpts.runArgs,
  ];

  // Reuse runRalphaiRunner by constructing options with the worktree as cwd
  const worktreeRunOptions: RalphaiOptions = {
    ...options,
    subcommand: "run",
    runArgs: runnerArgs,
  };

  try {
    await runRalphaiRunner(worktreeRunOptions, resolvedWorktreeDir);
  } catch {
    // runRalphaiRunner calls process.exit() internally, so this catch
    // handles edge cases where it throws instead
  }

  // Note: cleanup after runner completion happens via process.exit in
  // runRalphaiRunner. For proper lifecycle management (cleanup on success,
  // preserve on failure), we'd need to refactor runRalphaiRunner to return
  // an exit code instead of calling process.exit. That's a future improvement.
}

/**
 * Resolve the path to a bash executable.
 *
 * On Windows (Git Bash / MSYS2) `spawnSync` cannot execute `.sh` files
 * directly and the mintty pty layer can swallow stdout from synchronously
 * spawned child processes.  We therefore need to locate `bash.exe` so we
 * can invoke the script explicitly.
 *
 * Search order:
 *  1. `bash` on PATH (works when running *inside* Git Bash)
 *  2. Common Git-for-Windows install locations
 */
function findBash(): string | null {
  // Fast path: try `bash` on PATH
  try {
    execSync("bash --version", { stdio: "ignore" });
    return "bash";
  } catch {
    // not on PATH
  }

  if (process.platform === "win32") {
    const candidates = [
      join(
        process.env.PROGRAMFILES ?? "C:\\Program Files",
        "Git",
        "bin",
        "bash.exe",
      ),
      join(
        process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
        "Git",
        "bin",
        "bash.exe",
      ),
      join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "Git",
        "bin",
        "bash.exe",
      ),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

function resolveBundledRunnerScript(moduleUrl: string): string {
  if (process.env.RALPHAI_RUNNER_SCRIPT) {
    return process.env.RALPHAI_RUNNER_SCRIPT;
  }

  const packageDir = join(dirname(fileURLToPath(moduleUrl)), "..");
  const candidates = [
    ["runner", "ralphai.sh"],
    ["templates", "ralphai", "ralphai.sh"],
  ].map((segments) => join(packageDir, ...segments));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not locate bundled runner script. Tried: ${candidates.join(", ")}`,
  );
}

function runRalphaiRunner(
  options: RalphaiOptions,
  cwd: string,
): Promise<never> {
  // Check that ralphai has been initialized (config dir exists).
  // In a worktree, .ralphai/ lives in the main repo — resolveRalphaiDir()
  // handles the fallback transparently.
  const ralphaiRoot = resolveRalphaiDir(cwd);
  if (!ralphaiRoot) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Check receipt files for cross-source conflicts before spawning the runner.
  // This provides early TypeScript-level blocking; the bash runner also checks.
  const ralphaiDir = join(ralphaiRoot, ".ralphai");
  if (!checkReceiptSource(ralphaiDir, isGitWorktree(cwd))) {
    process.exit(1);
  }

  // Resolve the runner script from the npm package (not the user's project).
  // RALPHAI_RUNNER_SCRIPT env var allows overriding for tests.
  let ralphaiSh: string;
  try {
    ralphaiSh = resolveBundledRunnerScript(import.meta.url);
  } catch (error) {
    console.error(
      `${TEXT}Error:${RESET} ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const args = options.runArgs;

  const isWindows = process.platform === "win32";
  // Git Bash / MSYS2 sets MSYSTEM; mintty-based terminals may also set
  // TERM_PROGRAM=mintty.  In these environments Node cannot directly
  // execute `.sh` files, so we need to locate `bash.exe` explicitly.
  const isMsys = !!(
    process.env.MSYSTEM || process.env.TERM_PROGRAM === "mintty"
  );

  if (isWindows || isMsys) {
    // On Windows / MSYS: locate bash explicitly since Node cannot run
    // `.sh` files directly on this platform.
    const bash = findBash();
    if (!bash) {
      console.error(
        `${TEXT}Error:${RESET} Could not find bash. ` +
          `Install Git for Windows (https://git-scm.com) and ensure bash is on your PATH.`,
      );
      process.exit(1);
    }

    // Convert Windows path to a form bash understands (forward slashes)
    const scriptPath = ralphaiSh.replace(/\\/g, "/");

    // Use stdio "inherit" so the child shares the parent's file descriptors
    // directly.  This avoids pipe-buffering issues that cause output to stall
    // on Windows (Git Bash / mintty / PowerShell / cmd) where the MSYS2 PTY
    // layer + Node.js pipe chain can swallow or delay agent output.  Shell-
    // level redirection (e.g. `ralphai run > log.txt`) still works because it
    // operates on the inherited file descriptors.
    const child = spawn(bash, [scriptPath, ...args], {
      cwd,
      stdio: "inherit",
      env: { ...process.env },
    });

    return new Promise((_resolve, _reject) => {
      child.on("close", (code) => {
        process.exit(code ?? 1);
      });

      child.on("error", (err) => {
        console.error(
          `${TEXT}Error:${RESET} Failed to start bash: ${err.message}`,
        );
        process.exit(1);
      });
    });
  } else {
    // Unix: inherit stdio so the child writes directly to the terminal,
    // matching the Windows path and avoiding unnecessary pipe buffering.
    const child = spawn(ralphaiSh, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env },
    });

    return new Promise((_resolve, _reject) => {
      child.on("close", (code) => {
        process.exit(code ?? 1);
      });
      child.on("error", (err) => {
        console.error(
          `${TEXT}Error:${RESET} Failed to start task runner ${ralphaiSh}: ${err.message}`,
        );
        process.exit(1);
      });
    });
  }
}

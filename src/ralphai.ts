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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RalphaiSubcommand =
  | "init"
  | "update"
  | "run"
  | "uninstall"
  | "worktree"
  | "status"
  | "reset";

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
  agentCommand?: string;
  targetDir?: string;
  runArgs: string[];
  worktreeOptions?: WorktreeOptions;
}

interface WizardAnswers {
  agentCommand: string;
  baseBranch: string;
  feedbackCommands: string;
  issueSource: "none" | "github";
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
  "uninstall",
  "worktree",
  "status",
  "reset",
]);

function parseRalphaiOptions(args: string[]): RalphaiOptions {
  let subcommand: RalphaiSubcommand | undefined;
  let yes = false;
  let force = false;
  let agentCommand: string | undefined;
  let targetDir: string | undefined;
  const runArgs: string[] = [];
  let worktreeOptions: WorktreeOptions | undefined;

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
    }
  }

  return {
    subcommand,
    yes,
    force,
    agentCommand,
    targetDir,
    runArgs,
    worktreeOptions,
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
// Package manager detection
// ---------------------------------------------------------------------------

type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

interface DetectedPM {
  manager: PackageManager;
  /** Prefix for running scripts, e.g. "pnpm" or "bun run" */
  runPrefix: string;
}

/**
 * Detect the project's package manager by checking for lock files and config
 * files in priority order. Returns null for non-JS/TS projects.
 */
function detectPackageManager(cwd: string): DetectedPM | null {
  const has = (file: string) => existsSync(join(cwd, file));

  // Deno — checked first since deno.json is unambiguous
  if (has("deno.json") || has("deno.jsonc")) {
    return { manager: "deno", runPrefix: "deno task" };
  }

  // Lock-file based detection (most reliable)
  if (has("bun.lockb") || has("bun.lock")) {
    return { manager: "bun", runPrefix: "bun run" };
  }
  if (has("pnpm-lock.yaml") || has("pnpm-workspace.yaml")) {
    return { manager: "pnpm", runPrefix: "pnpm" };
  }
  if (has("yarn.lock")) {
    return { manager: "yarn", runPrefix: "yarn" };
  }
  if (has("package-lock.json")) {
    return { manager: "npm", runPrefix: "npm run" };
  }

  // Fallback: check packageManager field in package.json
  const pkgPath = join(cwd, "package.json");
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.packageManager === "string") {
        const name = pkg.packageManager.split("@")[0] as string;
        if (name === "pnpm") return { manager: "pnpm", runPrefix: "pnpm" };
        if (name === "yarn") return { manager: "yarn", runPrefix: "yarn" };
        if (name === "bun") return { manager: "bun", runPrefix: "bun run" };
        if (name === "npm") return { manager: "npm", runPrefix: "npm run" };
      }
      // package.json exists but no packageManager field — default to npm
      return { manager: "npm", runPrefix: "npm run" };
    } catch {
      return { manager: "npm", runPrefix: "npm run" };
    }
  }

  // No JS/TS project signals found
  return null;
}

/** Well-known script names to look for, in display order. */
const SCRIPT_CANDIDATES = [
  "build",
  "test",
  "type-check",
  "typecheck",
  "lint",
  "format:check",
];

/**
 * Detect feedback commands by inspecting the project's package.json scripts
 * (or deno.json tasks) and mapping them through the detected package manager.
 * Returns a comma-separated string suitable for the feedbackCommands config key,
 * or an empty string if nothing useful is detected.
 */
function detectFeedbackCommands(cwd: string): string {
  const pm = detectPackageManager(cwd);
  if (!pm) return "";

  const commands: string[] = [];

  if (pm.manager === "deno") {
    // Read tasks from deno.json / deno.jsonc
    for (const name of ["deno.json", "deno.jsonc"]) {
      const denoPath = join(cwd, name);
      if (!existsSync(denoPath)) continue;
      try {
        const deno = JSON.parse(readFileSync(denoPath, "utf-8"));
        const tasks = deno.tasks;
        if (tasks && typeof tasks === "object") {
          for (const script of SCRIPT_CANDIDATES) {
            if (script in tasks) {
              commands.push(`deno task ${script}`);
            }
          }
        }
      } catch {
        // ignore parse errors
      }
      break; // only read the first one found
    }
    // deno has a built-in test runner even without a task
    if (
      !commands.some((c) => c.includes("test")) &&
      existsSync(join(cwd, "deno.json"))
    ) {
      commands.push("deno test");
    }
  } else {
    // npm/pnpm/yarn/bun — read scripts from package.json
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return "";
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") {
        // For test, npm/pnpm/yarn/bun all support the short form (e.g. "pnpm test")
        const testShorthand = ["npm", "pnpm", "yarn", "bun"];
        for (const script of SCRIPT_CANDIDATES) {
          if (!(script in scripts)) continue;
          if (script === "test" && testShorthand.includes(pm.manager)) {
            commands.push(`${pm.manager} test`);
          } else {
            commands.push(`${pm.runPrefix} ${script}`);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return commands.join(",");
}

// ---------------------------------------------------------------------------
// Base branch detection
// ---------------------------------------------------------------------------

function detectBaseBranch(): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // fallback: check if main or master exists
    try {
      execSync("git show-ref --verify refs/heads/main", { stdio: "ignore" });
      return "main";
    } catch {
      try {
        execSync("git show-ref --verify refs/heads/master", {
          stdio: "ignore",
        });
        return "master";
      } catch {
        return "main";
      }
    }
  }
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
  const detectedBranch = detectBaseBranch();
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

  // 3. Feedback commands (auto-detected from package manager + scripts)
  const detectedFeedback = detectFeedbackCommands(cwd);
  const pm = detectPackageManager(cwd);
  const feedbackPlaceholder = pm
    ? `${pm.runPrefix} build, ${pm.manager} test, ${pm.runPrefix} lint`
    : "npm run build, npm test, npm run lint";
  const feedbackCommands = await clack.text({
    message: detectedFeedback
      ? `Feedback commands (auto-detected for ${pm!.manager}):`
      : "Feedback commands (comma-separated, or leave empty):",
    initialValue: detectedFeedback || undefined,
    placeholder: detectedFeedback ? undefined : feedbackPlaceholder,
    defaultValue: detectedFeedback || "",
  });

  if (clack.isCancel(feedbackCommands)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 4. GitHub Issues integration
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

  return {
    agentCommand,
    baseBranch,
    feedbackCommands: feedbackCommands || "",
    issueSource: enableIssues ? "github" : "none",
  };
}

// ---------------------------------------------------------------------------
// Uninstall logic
// ---------------------------------------------------------------------------

async function uninstallRalphai(
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
    clack.intro("Uninstalling Ralphai");
    const confirmed = await clack.confirm({
      message:
        "This will permanently delete .ralphai/. " +
        "Any plans and learnings in .ralphai/ will be lost. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Uninstall cancelled.");
      return;
    }
  }

  // Remove .ralphai/ directory
  rmSync(ralphaiDir, { recursive: true, force: true });

  console.log(`${TEXT}Ralphai uninstalled.${RESET}`);
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

function scaffold(answers: WizardAnswers, cwd: string): void {
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

  // Generate config (JSON format)
  const configObj: Record<string, string | string[]> = {
    agentCommand: answers.agentCommand,
    baseBranch: answers.baseBranch,
  };

  if (answers.feedbackCommands) {
    // Split comma-separated string into a JSON array
    configObj.feedbackCommands = answers.feedbackCommands
      .split(",")
      .map((cmd) => cmd.trim())
      .filter((cmd) => cmd.length > 0);
  }

  if (answers.issueSource === "github") {
    configObj.issueSource = "github";
  }

  const config = JSON.stringify(configObj, null, 2) + "\n";

  writeFileSync(join(ralphaiDir, "ralphai.config.json"), config);

  // Create subdirectories with .gitkeep
  for (const subdir of ["backlog", "wip", "in-progress", "out"]) {
    const subdirPath = join(ralphaiDir, "pipeline", subdir);
    mkdirSync(subdirPath, { recursive: true });
    writeFileSync(join(subdirPath, ".gitkeep"), "");
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

  // Create .ralphai/.gitignore — plan files are local-only state, not tracked by git
  const gitignoreContent = `# Plan files are local-only state (not tracked by git).
# Only the directory structure (.gitkeep), config, and docs are committed.
pipeline/backlog/*.md
pipeline/wip/*.md
pipeline/in-progress/*.md
pipeline/in-progress/progress.md
pipeline/out/
LEARNINGS.md
`;
  writeFileSync(join(ralphaiDir, ".gitignore"), gitignoreContent);

  // Create GitHub labels if issues integration is enabled
  let labelResult: LabelResult | null = null;
  if (answers.issueSource === "github") {
    labelResult = ensureGitHubLabels(cwd);
  }

  // Print success output
  console.log(`${TEXT}Ralphai initialized in .ralphai/${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(
    `  .ralphai/ralphai.config.json ${DIM}Configuration (edit to customize)${RESET}`,
  );
  console.log(`  .ralphai/README.md         ${DIM}Operational docs${RESET}`);
  console.log(`  .ralphai/PLANNING.md   ${DIM}How to write plans${RESET}`);
  console.log(
    `  .ralphai/LEARNINGS.md      ${DIM}Ralphai-specific learnings (gitignored)${RESET}`,
  );
  console.log(`  .ralphai/pipeline/backlog/ ${DIM}Queue plans here${RESET}`);
  console.log(
    `  .ralphai/pipeline/wip/     ${DIM}Park unready plans here${RESET}`,
  );
  if (labelResult) {
    if (labelResult.success) {
      console.log(
        `  GitHub labels            ${DIM}Created "ralphai" and "ralphai:in-progress" labels${RESET}`,
      );
    } else {
      console.log();
      console.log(`${TEXT}Warning:${RESET} ${DIM}${labelResult.error}${RESET}`);
    }
  }
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(
    `  1. Review ${TEXT}.ralphai/ralphai.config.json${RESET} and adjust settings`,
  );
  console.log(
    `  2. Read ${TEXT}.ralphai/PLANNING.md${RESET} for how to write plans`,
  );
  console.log(
    `  3. Create your first plan in ${TEXT}.ralphai/pipeline/backlog/${RESET}`,
  );
  console.log(`  4. Preview:  ${TEXT}ralphai run --dry-run${RESET}`);
  console.log(`  5. Run:      ${TEXT}ralphai run${RESET}`);
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
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
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

  const files = readdirSync(inProgressDir);
  const planFiles = files.filter(
    (f) => f.endsWith(".md") && f !== "progress.md",
  );
  const progressFile = files.includes("progress.md") ? "progress.md" : null;
  const receiptFiles = files.filter(
    (f) => f.startsWith("receipt-") && f.endsWith(".txt"),
  );

  // Check for worktrees to clean
  let worktrees: WorktreeEntry[] = [];
  try {
    worktrees = listRalphaiWorktrees(ralphaiRoot);
  } catch {
    // Not in a git repo or git not available
  }

  if (
    planFiles.length === 0 &&
    !progressFile &&
    receiptFiles.length === 0 &&
    worktrees.length === 0
  ) {
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
  if (progressFile) {
    console.log(
      `  ${TEXT}Progress${RESET}    ${DIM}progress.md will be deleted${RESET}`,
    );
  }
  if (receiptFiles.length > 0) {
    console.log(
      `  ${TEXT}Receipts${RESET}    ${DIM}${receiptFiles.length} receipt${receiptFiles.length !== 1 ? "s" : ""} will be deleted${RESET}`,
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

  // 1. Move plan files back to backlog
  for (const planFile of planFiles) {
    const src = join(inProgressDir, planFile);
    const dest = join(backlogDir, planFile);
    mkdirSync(backlogDir, { recursive: true });
    renameSync(src, dest);
    actions++;
  }

  // 2. Delete progress.md
  if (progressFile) {
    rmSync(join(inProgressDir, progressFile), { force: true });
    actions++;
  }

  // 3. Delete receipt files
  for (const receiptFile of receiptFiles) {
    rmSync(join(inProgressDir, receiptFile), { force: true });
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
        execSync(`git worktree remove "${wt.path}"`, {
          cwd: ralphaiRoot,
          stdio: "pipe",
        });
        // Try to delete branch (may fail if not merged — that's ok)
        try {
          execSync(`git branch -d "${wt.branch}"`, {
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
  if (progressFile) {
    console.log(`  Deleted progress.md`);
  }
  if (receiptFiles.length > 0) {
    console.log(
      `  Deleted ${receiptFiles.length} receipt${receiptFiles.length !== 1 ? "s" : ""}`,
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
    `  ${TEXT}update${RESET}      ${DIM}Update ralphai to the latest (or specified) version${RESET}`,
  );
  console.log(
    `  ${TEXT}uninstall${RESET}   ${DIM}Remove Ralphai from your project${RESET}`,
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

  switch (options.subcommand) {
    case "init":
      await runRalphaiInit(options, cwd);
      break;
    case "update":
      runSelfUpdate({
        packageName: "ralphai",
        tag: options.targetDir, // first positional arg after "update" is parsed as targetDir
      });
      break;
    case "uninstall":
      await uninstallRalphai(options, cwd);
      break;
    case "run":
      await runRalphaiRunner(options, cwd);
      break;
    case "worktree":
      await runRalphaiWorktree(options, cwd);
      break;
    case "status":
      runRalphaiStatus(cwd);
      break;
    case "reset":
      await runRalphaiReset(options, cwd);
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

async function runRalphaiInit(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  // Block init inside a git worktree — .ralphai/ must live in the main repo
  if (isGitWorktree(cwd)) {
    console.error(
      `${TEXT}Error:${RESET} Cannot initialize ralphai inside a git worktree.\n` +
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
        `${TEXT}Error:${RESET} Ralphai is already set up in this directory (.ralphai/ exists).\n` +
          `${DIM}Use ${TEXT}ralphai init --force${DIM} to re-scaffold from scratch.${RESET}`,
      );
      process.exit(1);
    }
  }

  let answers: WizardAnswers;

  if (options.yes) {
    // Non-interactive mode with defaults (auto-detect feedback commands)
    answers = {
      agentCommand: options.agentCommand || "opencode run --agent build",
      baseBranch: detectBaseBranch(),
      feedbackCommands: detectFeedbackCommands(cwd),
      issueSource: "none",
    };
  } else {
    // Interactive wizard
    const wizardResult = await runWizard(cwd);
    if (!wizardResult) {
      // User cancelled
      return;
    }
    answers = wizardResult;
  }

  scaffold(answers, cwd);
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
  agent: string;
  turns_completed: number;
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
    agent: fields.agent ?? "",
    turns_completed: parseInt(fields.turns_completed ?? "0", 10),
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

  const receiptFiles = readdirSync(inProgressDir).filter(
    (f) => f.startsWith("receipt-") && f.endsWith(".txt"),
  );
  for (const receiptFile of receiptFiles) {
    const receipt = parseReceipt(join(inProgressDir, receiptFile));
    if (!receipt) continue;

    if (receipt.source === "worktree" && !isWorktree) {
      console.error();
      console.error(
        `${TEXT}Error:${RESET} Plan "${receipt.slug}" is running in a worktree.`,
      );
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
        `${TEXT}Error:${RESET} Plan "${receipt.slug}" is already running in the main repository.`,
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
): SelectedWorktreePlan | null {
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");

  if (specificPlan) {
    const inProgressPath = join(inProgressDir, specificPlan);
    if (existsSync(inProgressPath)) {
      const slug = specificPlan.replace(/^prd-/, "").replace(/\.md$/, "");
      return { planFile: specificPlan, slug, source: "in-progress" };
    }
  }

  const inProgressPlans = existsSync(inProgressDir)
    ? readdirSync(inProgressDir).filter((f) => f.endsWith(".md"))
    : [];

  if (!specificPlan && inProgressPlans.length === 1) {
    const planFile = inProgressPlans[0]!;
    const slug = planFile.replace(/^prd-/, "").replace(/\.md$/, "");
    return { planFile, slug, source: "in-progress" };
  }

  if (!specificPlan && inProgressPlans.length > 1) {
    console.error(
      `${TEXT}Error:${RESET} Multiple plans are already in progress. Use ${TEXT}ralphai worktree --plan=<file>${RESET} to choose which one to resume.`,
    );
    for (const planFile of inProgressPlans) {
      console.error(`  ${planFile}`);
    }
    return null;
  }

  if (!existsSync(backlogDir)) {
    console.error(
      `${TEXT}Error:${RESET} No backlog directory found at ${backlogDir}`,
    );
    return null;
  }

  if (specificPlan) {
    const planPath = join(backlogDir, specificPlan);
    if (!existsSync(planPath)) {
      console.error(
        `${TEXT}Error:${RESET} Plan '${specificPlan}' not found in backlog.`,
      );
      return null;
    }
    const slug = specificPlan.replace(/^prd-/, "").replace(/\.md$/, "");
    return { planFile: specificPlan, slug, source: "backlog" };
  }

  // Find any .md file in backlog
  const plans = readdirSync(backlogDir).filter((f) => f.endsWith(".md"));

  if (plans.length === 0) {
    console.error(
      `${TEXT}Error:${RESET} No plans in backlog. Add a plan to .ralphai/pipeline/backlog/ first.`,
    );
    return null;
  }

  // Use the first plan (actual prioritization happens in the bash runner)
  const firstPlan = plans[0]!;
  const slug = firstPlan.replace(/^prd-/, "").replace(/\.md$/, "");
  return { planFile: firstPlan, slug, source: "backlog" };
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
    const hasActivePlan = existsSync(join(inProgressDir, `prd-${slug}.md`));
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
    const hasActivePlan = existsSync(join(inProgressDir, `prd-${slug}.md`));

    if (!hasActivePlan) {
      console.log(`Removing: ${wt.path} (${wt.branch})`);
      try {
        execSync(`git worktree remove "${wt.path}"`, {
          cwd,
          stdio: "inherit",
        });
        // Try to delete branch (may fail if not merged — that's ok)
        try {
          execSync(`git branch -d "${wt.branch}"`, {
            cwd,
            stdio: "pipe",
          });
        } catch {
          // Branch deletion failure is not critical
        }

        // Archive receipt if one exists for this slug
        const receiptFile = join(inProgressDir, `receipt-${slug}.txt`);
        if (existsSync(receiptFile)) {
          mkdirSync(archiveDir, { recursive: true });
          const timestamp = new Date()
            .toISOString()
            .replace(/[T:]/g, "-")
            .replace(/\.\d+Z$/, "");
          const dest = join(archiveDir, `receipt-${slug}-${timestamp}.txt`);
          renameSync(receiptFile, dest);
          console.log(`  Archived receipt: receipt-${slug}.txt`);
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

  // Count batch entries: `Tasks X–Y` or `Tasks X-Y`
  const batchMatches = content.matchAll(/Tasks?\s+(\d+)\s*[–-]\s*(\d+)/gi);
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

function runRalphaiStatus(cwd: string): void {
  // Resolve .ralphai/ — works from main repo or worktree
  const ralphaiRoot = resolveRalphaiDir(cwd);
  if (!ralphaiRoot) {
    console.error(
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const ralphaiDir = join(ralphaiRoot, ".ralphai");
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
  const archiveDir = join(ralphaiDir, "pipeline", "out");

  // --- Collect data ---
  const backlogPlans = existsSync(backlogDir)
    ? readdirSync(backlogDir).filter((f) => f.endsWith(".md"))
    : [];

  const inProgressFiles = existsSync(inProgressDir)
    ? readdirSync(inProgressDir)
    : [];
  const inProgressPlans = inProgressFiles.filter(
    (f) => f.endsWith(".md") && f !== "progress.md",
  );
  const receiptFiles = inProgressFiles.filter(
    (f) => f.startsWith("receipt-") && f.endsWith(".txt"),
  );

  const completedFiles = existsSync(archiveDir)
    ? readdirSync(archiveDir).filter(
        (f) => f.startsWith("prd-") && f.endsWith(".md"),
      )
    : [];
  // Deduplicate completed plans by removing timestamps
  const completedSlugs = new Set(
    completedFiles.map((f) => f.replace(/-\d{8}-\d{6}\.md$/, "")),
  );

  // Build receipt lookup: slug → Receipt
  const receiptsBySlug = new Map<string, Receipt>();
  for (const rf of receiptFiles) {
    const slug = rf.replace(/^receipt-/, "").replace(/\.txt$/, "");
    const receipt = parseReceipt(join(inProgressDir, rf));
    if (receipt) receiptsBySlug.set(slug, receipt);
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
    const deps = extractDependsOn(join(backlogDir, plan));
    if (deps.length > 0) {
      suffix = `${DIM}waiting on ${deps.join(", ")}${RESET}`;
    }
    console.log(`    ${DIM}${plan}${RESET}${suffix ? "  " + suffix : ""}`);
  }

  // In Progress
  console.log();
  console.log(
    `  ${TEXT}In Progress${RESET}  ${DIM}${inProgressPlans.length} plan${inProgressPlans.length !== 1 ? "s" : ""}${RESET}`,
  );
  for (const plan of inProgressPlans) {
    const slug = plan.replace(/^prd-/, "").replace(/\.md$/, "");
    const receipt = receiptsBySlug.get(slug);
    const parts: string[] = [];

    // Task progress
    const totalTasks = countPlanTasks(join(inProgressDir, plan));
    if (totalTasks > 0) {
      const progressFile = join(inProgressDir, "progress.md");
      const completed = countCompletedTasks(progressFile);
      parts.push(`${completed} of ${totalTasks} tasks`);
    }

    // Worktree info from receipt
    if (receipt?.source === "worktree") {
      parts.push(`worktree: ${slug}`);
    }

    const suffix =
      parts.length > 0 ? `${DIM}${parts.join("    ")}${RESET}` : "";
    console.log(`    ${DIM}${plan}${RESET}${suffix ? "  " + suffix : ""}`);
  }

  // Completed
  console.log();
  console.log(
    `  ${TEXT}Completed${RESET}   ${DIM}${completedSlugs.size} plan${completedSlugs.size !== 1 ? "s" : ""}${RESET}`,
  );

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
      const hasActivePlan = existsSync(join(inProgressDir, `prd-${slug}.md`));
      const state = hasActivePlan ? "in-progress" : "idle";
      console.log(
        `  ${DIM}${wt.branch}${RESET}  ${DIM}${wt.path}${RESET}  ${DIM}[${state}]${RESET}`,
      );
    }
  }

  // --- Problems section ---
  const problems: string[] = [];

  // Orphaned receipts: receipt exists but no matching plan file
  for (const [slug, _receipt] of receiptsBySlug) {
    if (!existsSync(join(inProgressDir, `prd-${slug}.md`))) {
      problems.push(
        `Orphaned receipt: receipt-${slug}.txt (no matching plan file)`,
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

  // Guard: must be in main repo, not a worktree
  if (isGitWorktree(cwd)) {
    console.error(
      `${TEXT}Error:${RESET} 'ralphai worktree' must be run from the main repository.`,
    );
    console.error(
      "You are inside a worktree. Run this command from the main repo.",
    );
    process.exit(1);
  }

  // Guard: .ralphai must exist
  if (!existsSync(join(cwd, ".ralphai"))) {
    console.error(
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  // Select plan (in-progress first, then backlog)
  const plan = selectPlanForWorktree(join(cwd, ".ralphai"), wtOpts.plan);
  if (!plan) process.exit(1);

  // Check receipt for cross-source conflicts: block if plan is running in main repo
  const receiptPath = join(
    cwd,
    ".ralphai",
    "pipeline",
    "in-progress",
    `receipt-${plan.slug}.txt`,
  );
  const receipt = parseReceipt(receiptPath);
  if (receipt && receipt.source === "main") {
    console.error();
    console.error(
      `${TEXT}Error:${RESET} Plan "${plan.slug}" is already running in the main repository.`,
    );
    console.error();
    console.error(`  Branch:  ${receipt.branch || "unknown"}`);
    console.error(`  Started: ${receipt.started_at || "unknown"}`);
    console.error();
    console.error(`  Finish or interrupt the main-repo run first, then retry.`);
    process.exit(1);
  }

  // Determine base branch
  const baseBranch = detectBaseBranch();
  const branch = `ralphai/${plan.slug}`;
  const activeWorktree = listRalphaiWorktrees(cwd).find(
    (wt) => wt.branch === branch,
  );

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
          stdio: "inherit",
        });
      } catch {
        console.error(
          `${TEXT}Error:${RESET} Failed to attach existing branch '${branch}' to a worktree.`,
        );
        process.exit(1);
      }
    } else {
      console.log(`Creating worktree: ${resolvedWorktreeDir}`);
      console.log(`Branch: ${branch} (from ${baseBranch})`);
      try {
        execSync(
          `git worktree add "${resolvedWorktreeDir}" -b "${branch}" "${baseBranch}"`,
          { cwd, stdio: "inherit" },
        );
      } catch {
        console.error(
          `${TEXT}Error:${RESET} Failed to create worktree. The branch '${branch}' may already exist.`,
        );
        process.exit(1);
      }
    }
  }

  // Symlink .ralphai/ from worktree → main repo so the agent can access
  // pipeline files as relative paths. Without this, agents with directory
  // sandboxing (OpenCode, Claude Code, Codex) reject reads/writes to the
  // main repo's .ralphai/ as "external directory" access.
  //
  // When .ralphai/ is git-tracked, `git worktree add` checks out its
  // tracked files as a real directory. We must replace it with a symlink
  // so pipeline state (gitignored files like plans, receipts, progress)
  // is shared with the main repo.
  const worktreeRalphaiLink = join(resolvedWorktreeDir, ".ralphai");
  const needsSymlink =
    !existsSync(worktreeRalphaiLink) ||
    !lstatSync(worktreeRalphaiLink).isSymbolicLink();
  if (needsSymlink) {
    // Remove the real directory (if any) before creating the symlink.
    // This is safe because the symlink target (main repo's .ralphai/)
    // contains all the same tracked files plus gitignored pipeline state.
    rmSync(worktreeRalphaiLink, { recursive: true, force: true });
    symlinkSync(join(cwd, ".ralphai"), worktreeRalphaiLink);
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
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
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

    const child = spawn(bash, [scriptPath, ...args], {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

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
    // Unix: use async spawn with piped output so users see output in real
    // time AND parent processes (e.g. test harness) can still capture it.
    const child = spawn(ralphaiSh, args, {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

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

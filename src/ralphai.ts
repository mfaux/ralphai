import { execSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  | "sync"
  | "run"
  | "uninstall"
  | "worktree";

type WorktreeSubcommand = "run" | "list" | "clean";

interface WorktreeOptions {
  subcommand: WorktreeSubcommand;
  plan?: string; // --plan=<file>
  dir?: string; // --dir=<path>
  runArgs: string[]; // passthrough args for the runner (--turns, --agent, etc.)
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
  "sync",
  "run",
  "uninstall",
  "worktree",
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

  // Generate config
  const feedbackLine = answers.feedbackCommands
    ? `feedbackCommands=${answers.feedbackCommands}`
    : (() => {
        // Use detected PM for the example comment
        const pm = detectPackageManager(cwd);
        if (!pm || pm.manager === "npm")
          return `# feedbackCommands=npm run build,npm test,npm run lint`;
        if (pm.manager === "deno")
          return `# feedbackCommands=deno task build,deno test,deno task lint`;
        const prefix = pm.runPrefix;
        return `# feedbackCommands=${prefix} build,${pm.manager} test,${prefix} lint`;
      })();

  const config = `# .ralphai/ralphai.config — repo-level defaults
# Precedence: CLI flags > env vars > config file > built-in defaults
agentCommand=${answers.agentCommand}
baseBranch=${answers.baseBranch}
${feedbackLine}
${answers.issueSource === "github" ? "issueSource=github" : "# issueSource=none"}
`;

  writeFileSync(join(ralphaiDir, "ralphai.config"), config);

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
    `  .ralphai/ralphai.config      ${DIM}Configuration (edit to customize)${RESET}`,
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
    `  1. Review ${TEXT}.ralphai/ralphai.config${RESET} and adjust settings`,
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
// Sync logic — refresh template files while preserving user state
// ---------------------------------------------------------------------------

/** Files that are copied from templates and safe to overwrite on sync. */
const TEMPLATE_FILES = ["README.md", "PLANNING.md"] as const;

async function syncRalphaiTemplates(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(__dir, "..", "templates", "ralphai");
  const ralphaiDir = join(cwd, ".ralphai");

  if (!options.yes) {
    clack.intro("Syncing Ralphai — refreshing template files");

    const confirmed = await clack.confirm({
      message:
        "This will overwrite README.md and PLANNING.md " +
        "from the latest templates. Your config and plan " +
        "files will be preserved. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Sync cancelled.");
      return;
    }
  }

  const updated: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];

  // Update template files (docs only — scripts now run from the package)
  for (const file of TEMPLATE_FILES) {
    const src = join(templatesDir, file);
    const dest = join(ralphaiDir, file);
    copyFileSync(src, dest);
    updated.push(file);
  }

  // Migration: remove old scaffolded scripts (now bundled in the package)
  const oldScript = join(ralphaiDir, "ralphai.sh");
  if (existsSync(oldScript)) {
    rmSync(oldScript);
    removed.push("ralphai.sh");
  }
  const oldLibDir = join(ralphaiDir, "lib");
  if (existsSync(oldLibDir)) {
    rmSync(oldLibDir, { recursive: true });
    removed.push("lib/");
  }

  // Report what was preserved
  for (const file of ["ralphai.config", ".gitignore"]) {
    if (existsSync(join(ralphaiDir, file))) {
      skipped.push(file);
    }
  }
  for (const subdir of ["backlog", "wip", "in-progress", "out"]) {
    if (existsSync(join(ralphaiDir, "pipeline", subdir))) {
      skipped.push(`pipeline/${subdir}/`);
    }
  }

  // Print results
  console.log(`${TEXT}Ralphai synced in .ralphai/${RESET}`);
  console.log();
  if (updated.length > 0) {
    console.log(`${DIM}Updated:${RESET}`);
    for (const file of updated) {
      console.log(`  .ralphai/${file}`);
    }
  }
  if (removed.length > 0) {
    console.log(`${DIM}Removed (now bundled in package):${RESET}`);
    for (const file of removed) {
      console.log(`  .ralphai/${file}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`${DIM}Preserved:${RESET}`);
    for (const file of skipped) {
      console.log(`  .ralphai/${file}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Help text
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
    `  ${TEXT}update${RESET}      ${DIM}Update ralphai to the latest (or specified) version${RESET}`,
  );
  console.log(
    `  ${TEXT}sync${RESET}        ${DIM}Refresh .ralphai/ template files from the installed version${RESET}`,
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
    case "sync":
      await runRalphaiSync(options, cwd);
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
    default:
      showRalphaiHelp();
      break;
  }
}

async function runRalphaiInit(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
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
          `${DIM}Use ${TEXT}ralphai sync${DIM} to refresh templates, ` +
          `or ${TEXT}ralphai init --force${DIM} to re-scaffold from scratch.${RESET}`,
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

async function runRalphaiSync(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  if (!existsSync(join(cwd, ".ralphai"))) {
    console.error(
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  await syncRalphaiTemplates(options, cwd);
}

// ---------------------------------------------------------------------------
// Worktree subcommand
// ---------------------------------------------------------------------------

function isGitWorktree(cwd: string): boolean {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // In a worktree, --git-dir points to .git/worktrees/<name>
    // while --git-common-dir points to the main repo's .git directory
    return resolve(cwd, gitDir) !== resolve(cwd, gitCommonDir);
  } catch {
    return false;
  }
}

interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
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
): { planFile: string; slug: string } | null {
  const backlogDir = join(ralphaiDir, "pipeline", "backlog");

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
    return { planFile: specificPlan, slug };
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
  return { planFile: firstPlan, slug };
}

function showWorktreeHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai worktree [command] [options]`);
  console.log();
  console.log(`${TEXT}Commands:${RESET}`);
  console.log(
    `  ${DIM}(default)${RESET}   ${DIM}Create a worktree, run a plan, and clean up on completion${RESET}`,
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
    `${DIM}All other options are forwarded to the task runner.${RESET}`,
  );
}

function listWorktrees(cwd: string): void {
  const output = execSync("git worktree list --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const worktrees = parseWorktreeList(output).filter((wt) =>
    wt.branch.startsWith("ralphai/"),
  );

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

  const output = execSync("git worktree list --porcelain", {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const worktrees = parseWorktreeList(output).filter((wt) =>
    wt.branch.startsWith("ralphai/"),
  );

  if (worktrees.length === 0) {
    console.log("No ralphai worktrees to clean.");
    return;
  }

  const ralphaiDir = join(cwd, ".ralphai");
  const inProgressDir = join(ralphaiDir, "pipeline", "in-progress");
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

  // Select plan
  const plan = selectPlanForWorktree(join(cwd, ".ralphai"), wtOpts.plan);
  if (!plan) process.exit(1);

  // Determine base branch
  const baseBranch = detectBaseBranch();
  const branch = `ralphai/${plan.slug}`;

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

  // Create worktree
  console.log(`Creating worktree: ${worktreeDir}`);
  console.log(`Branch: ${branch} (from ${baseBranch})`);
  try {
    execSync(
      `git worktree add "${worktreeDir}" -b "${branch}" "${baseBranch}"`,
      { cwd, stdio: "inherit" },
    );
  } catch {
    console.error(
      `${TEXT}Error:${RESET} Failed to create worktree. The branch '${branch}' may already exist.`,
    );
    process.exit(1);
  }

  // Spawn ralphai runner in the worktree
  console.log("Running ralphai in worktree...");
  const runnerArgs = ["--pr", ...wtOpts.runArgs];

  // Reuse runRalphaiRunner by constructing options with the worktree as cwd
  const worktreeRunOptions: RalphaiOptions = {
    ...options,
    subcommand: "run",
    runArgs: runnerArgs,
  };

  try {
    await runRalphaiRunner(worktreeRunOptions, worktreeDir);
  } catch {
    // runRalphaiRunner calls process.exit() internally, so this catch
    // handles edge cases where it throws instead
  }

  // Note: cleanup after runner completion happens via process.exit in
  // runRalphaiRunner. For proper lifecycle management (cleanup on success,
  // preserve on failure), we'd need to refactor runRalphaiRunner to return
  // an exit code instead of calling process.exit. That's a future improvement.
}

/** Default turn count when `ralphai run` is invoked without args. */
const DEFAULT_TURNS = "5";

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
  // Check that ralphai has been initialized (config dir exists)
  if (!existsSync(join(cwd, ".ralphai"))) {
    console.error(
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
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

  const args = options.runArgs.length > 0 ? options.runArgs : [DEFAULT_TURNS];

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

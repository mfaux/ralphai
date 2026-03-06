import { execSync, spawnSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as clack from "@clack/prompts";
import { RESET, DIM, TEXT } from "./utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RalphaiSubcommand = "init" | "update" | "run" | "uninstall";

interface RalphaiOptions {
  subcommand: RalphaiSubcommand | undefined;
  yes: boolean;
  force: boolean;
  agentCommand?: string;
  targetDir?: string;
  runArgs: string[];
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
]);

function parseRalphaiOptions(args: string[]): RalphaiOptions {
  let subcommand: RalphaiSubcommand | undefined;
  let yes = false;
  let force = false;
  let agentCommand: string | undefined;
  let targetDir: string | undefined;
  const runArgs: string[] = [];

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
      } else {
        targetDir = arg;
      }
    }
  }

  return { subcommand, yes, force, agentCommand, targetDir, runArgs };
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
entries to the repo-level \`LEARNINGS.md\` when they have lasting value.

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
pipeline/in-progress/progress.txt
pipeline/out/
LEARNINGS.md
`;
  writeFileSync(join(ralphaiDir, ".gitignore"), gitignoreContent);

  // Seed repo-root LEARNINGS.md if it does not exist
  const learningsPath = join(cwd, "LEARNINGS.md");
  const createdLearnings = !existsSync(learningsPath);
  if (createdLearnings) {
    writeFileSync(learningsPath, "# Learnings\n");
  }

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
  if (createdLearnings) {
    console.log(
      `  LEARNINGS.md             ${DIM}Maintainer-curated learnings Ralphai reads for long-term guidance${RESET}`,
    );
  }
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
// Update logic — refresh template files while preserving user state
// ---------------------------------------------------------------------------

/** Files that are copied from templates and safe to overwrite on update. */
const TEMPLATE_FILES = ["README.md", "PLANNING.md"] as const;

async function updateRalphai(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(__dir, "..", "templates", "ralphai");
  const ralphaiDir = join(cwd, ".ralphai");

  if (!options.yes) {
    clack.intro("Updating Ralphai — refreshing template files");

    const confirmed = await clack.confirm({
      message:
        "This will overwrite README.md and PLANNING.md " +
        "from the latest templates. Your config, LEARNINGS.md, and plan " +
        "files will be preserved. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Update cancelled.");
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
  for (const file of ["ralphai.config", "LEARNINGS.md", ".gitignore"]) {
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
  console.log(`${TEXT}Ralphai updated in .ralphai/${RESET}`);
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
    `  ${TEXT}update${RESET}      ${DIM}Refresh Ralphai template files (preserves config & state)${RESET}`,
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
      await runRalphaiUpdate(options, cwd);
      break;
    case "uninstall":
      await uninstallRalphai(options, cwd);
      break;
    case "run":
      await runRalphaiRunner(options, cwd);
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
            "Your config, LEARNINGS.md, and any plan files will be LOST. Continue?",
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
          `${DIM}Use ${TEXT}ralphai update${DIM} to refresh templates, ` +
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

async function runRalphaiUpdate(
  options: RalphaiOptions,
  cwd: string,
): Promise<void> {
  if (!existsSync(join(cwd, ".ralphai"))) {
    console.error(
      `${TEXT}Error:${RESET} Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  await updateRalphai(options, cwd);
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
  const __dir = dirname(fileURLToPath(import.meta.url));
  const ralphaiSh =
    process.env.RALPHAI_RUNNER_SCRIPT ||
    join(__dir, "..", "templates", "ralphai", "ralphai.sh");

  const args = options.runArgs.length > 0 ? options.runArgs : [DEFAULT_TURNS];

  const isWindows = process.platform === "win32";
  // Git Bash / MSYS2 sets MSYSTEM; mintty-based terminals may also set
  // TERM_PROGRAM=mintty.  In these environments `spawnSync` with
  // `stdio: "inherit"` silently drops output because Node's synchronous
  // child-process implementation cannot write to the mintty pty.
  const isMsys = !!(
    process.env.MSYSTEM || process.env.TERM_PROGRAM === "mintty"
  );

  if (isWindows || isMsys) {
    // On Windows / MSYS: use async spawn with explicit bash to avoid
    // swallowed output.
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
    // Unix: straightforward spawnSync with inherited stdio
    const result = spawnSync(ralphaiSh, args, {
      cwd,
      stdio: "inherit",
    });

    process.exit(result.status ?? 1);
  }
}

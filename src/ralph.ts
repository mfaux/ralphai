import { execSync, spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
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

type RalphSubcommand = "init" | "update" | "run" | "uninstall";

interface RalphOptions {
  subcommand: RalphSubcommand | undefined;
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
  protectedBranches: string;
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

const SUBCOMMANDS = new Set<RalphSubcommand>([
  "init",
  "update",
  "run",
  "uninstall",
]);

function parseRalphOptions(args: string[]): RalphOptions {
  let subcommand: RalphSubcommand | undefined;
  let yes = false;
  let force = false;
  let agentCommand: string | undefined;
  let targetDir: string | undefined;
  const runArgs: string[] = [];

  let collectingRunArgs = false;

  for (const arg of args) {
    // After `--`, collect remaining args for the `run` subcommand
    if (collectingRunArgs) {
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
      if (!subcommand && SUBCOMMANDS.has(arg as RalphSubcommand)) {
        subcommand = arg as RalphSubcommand;
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
  clack.intro("Setting up Ralph — autonomous task runner");

  clack.note(
    "Ralph picks up plan files from .ralph/backlog/ and drives an AI\n" +
      "coding agent to implement them autonomously, with built-in\n" +
      "feedback loops, git hygiene, and safety rails.",
    "What is Ralph?",
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

  // 4. Protected branches
  const protectedBranches = await clack.text({
    message: "Protected branches (comma-separated):",
    initialValue: "main,master",
    validate: (value) => {
      if (!value.trim()) return "At least one protected branch is required";
    },
  });

  if (clack.isCancel(protectedBranches)) {
    clack.cancel("Setup cancelled.");
    return null;
  }

  // 5. GitHub Issues integration
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
      "When Ralph's backlog is empty, it will automatically pull the oldest\n" +
        'open issue labeled "ralphai" and convert it to a plan.',
      "GitHub Issues",
    );
  }

  return {
    agentCommand,
    baseBranch,
    feedbackCommands: feedbackCommands || "",
    protectedBranches,
    issueSource: enableIssues ? "github" : "none",
  };
}

// ---------------------------------------------------------------------------
// package.json script injection
// ---------------------------------------------------------------------------

function addNpmScript(cwd: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts) pkg.scripts = {};
    if (pkg.scripts.ralph) return false; // already has a ralph script
    pkg.scripts.ralph = ".ralph/ralph.sh";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// package.json script removal
// ---------------------------------------------------------------------------

function removeNpmScript(cwd: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts?.ralph) return false;
    delete pkg.scripts.ralph;
    // Clean up empty scripts object
    if (Object.keys(pkg.scripts).length === 0) {
      delete pkg.scripts;
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Uninstall logic
// ---------------------------------------------------------------------------

async function uninstallRalph(
  options: RalphOptions,
  cwd: string,
): Promise<void> {
  const ralphDir = join(cwd, ".ralph");

  if (!existsSync(ralphDir)) {
    console.log(
      `${TEXT}Ralph is not set up in this project (.ralph/ does not exist).${RESET}`,
    );
    return;
  }

  if (!options.yes) {
    clack.intro("Uninstalling Ralph");
    const confirmed = await clack.confirm({
      message:
        "This will permanently delete .ralph/ and remove the npm script. " +
        "Any plans and learnings in .ralph/ will be lost. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Uninstall cancelled.");
      return;
    }
  }

  // Remove .ralph/ directory
  rmSync(ralphDir, { recursive: true, force: true });

  // Remove npm script
  const removedScript = removeNpmScript(cwd);

  console.log(`${TEXT}Ralph uninstalled.${RESET}`);
  console.log();
  console.log(`${DIM}Removed:${RESET}`);
  console.log(`  .ralph/                  ${DIM}Entire directory${RESET}`);
  if (removedScript) {
    console.log(
      `  package.json             ${DIM}Removed "ralph" script${RESET}`,
    );
  }
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
  const templatesDir = join(__dir, "..", "templates", "ralph");

  const ralphDir = join(cwd, ".ralph");

  // Create .ralph/ directory
  mkdirSync(ralphDir, { recursive: true });

  // Copy template files
  copyFileSync(join(templatesDir, "ralph.sh"), join(ralphDir, "ralph.sh"));
  chmodSync(join(ralphDir, "ralph.sh"), 0o755);

  copyFileSync(join(templatesDir, "README.md"), join(ralphDir, "README.md"));
  copyFileSync(
    join(templatesDir, "WRITING-PLANS.md"),
    join(ralphDir, "WRITING-PLANS.md"),
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

  const config = `# .ralph/ralph.config — repo-level defaults
# Precedence: CLI flags > env vars > config file > built-in defaults
agentCommand=${answers.agentCommand}
baseBranch=${answers.baseBranch}
${feedbackLine}
protectedBranches=${answers.protectedBranches}
${answers.issueSource === "github" ? "issueSource=github" : "# issueSource=none"}
`;

  writeFileSync(join(ralphDir, "ralph.config"), config);

  // Create subdirectories with .gitkeep
  for (const subdir of ["backlog", "drafts", "in-progress", "out"]) {
    const subdirPath = join(ralphDir, subdir);
    mkdirSync(subdirPath, { recursive: true });
    writeFileSync(join(subdirPath, ".gitkeep"), "");
  }

  // Create .ralph/LEARNINGS.md — Ralph-specific learnings (gitignored, local-only)
  const learningsContent = `# Ralph Learnings

Mistakes and lessons learned during autonomous runs. This file is **gitignored** —
Ralph reads and writes it automatically. Review periodically and promote useful
entries to the repo-level \`LEARNINGS.md\` when they have lasting value.

## Format

Each entry should include:

- **Date**: When the mistake was made
- **What went wrong**: Brief description of the error
- **Root cause**: Why it happened
- **Fix / Prevention**: How to avoid it in the future

---

<!-- Entries are added automatically by Ralph during autonomous runs -->
`;
  writeFileSync(join(ralphDir, "LEARNINGS.md"), learningsContent);

  // Create .ralph/.gitignore — plan files are local-only state, not tracked by git
  const gitignoreContent = `# Plan files are local-only state (not tracked by git).
# Only the directory structure (.gitkeep) and config/scripts are committed.
backlog/*.md
drafts/*.md
in-progress/*.md
in-progress/progress.txt
out/
LEARNINGS.md
`;
  writeFileSync(join(ralphDir, ".gitignore"), gitignoreContent);

  // Seed repo-root LEARNINGS.md if it does not exist
  const learningsPath = join(cwd, "LEARNINGS.md");
  const createdLearnings = !existsSync(learningsPath);
  if (createdLearnings) {
    writeFileSync(learningsPath, "# Learnings\n");
  }

  // Inject npm script if package.json exists
  const addedNpmScript = addNpmScript(cwd);

  // Create GitHub labels if issues integration is enabled
  let labelResult: LabelResult | null = null;
  if (answers.issueSource === "github") {
    labelResult = ensureGitHubLabels(cwd);
  }

  // Print success output
  console.log(`${TEXT}Ralph initialized in .ralph/${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(
    `  .ralph/ralph.sh          ${DIM}Autonomous task runner${RESET}`,
  );
  console.log(
    `  .ralph/ralph.config      ${DIM}Configuration (edit to customize)${RESET}`,
  );
  console.log(`  .ralph/README.md         ${DIM}Operational docs${RESET}`);
  console.log(`  .ralph/WRITING-PLANS.md  ${DIM}How to write plans${RESET}`);
  console.log(
    `  .ralph/LEARNINGS.md      ${DIM}Ralph-specific learnings (gitignored)${RESET}`,
  );
  console.log(`  .ralph/backlog/          ${DIM}Queue plans here${RESET}`);
  console.log(
    `  .ralph/drafts/           ${DIM}Park unready plans here${RESET}`,
  );
  if (createdLearnings) {
    console.log(
      `  LEARNINGS.md             ${DIM}Maintainer-curated learnings Ralph reads for long-term guidance${RESET}`,
    );
  }
  if (addedNpmScript) {
    console.log(
      `  package.json             ${DIM}Added "ralph" script${RESET}`,
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
    `  1. Review ${TEXT}.ralph/ralph.config${RESET} and adjust settings`,
  );
  console.log(
    `  2. Read ${TEXT}.ralph/WRITING-PLANS.md${RESET} for how to write plans`,
  );
  console.log(`  3. Create your first plan in ${TEXT}.ralph/backlog/${RESET}`);
  console.log(`  4. Preview:  ${TEXT}./.ralph/ralph.sh --dry-run${RESET}`);
  console.log(`  5. Run:      ${TEXT}./.ralph/ralph.sh 10${RESET}`);
  if (addedNpmScript) {
    console.log(
      `     Alt:      ${TEXT}npm run ralph -- 10${RESET} ${DIM}(or pass other args with --)${RESET}`,
    );
  }
  if (answers.issueSource === "github") {
    console.log();
    console.log(
      `${DIM}Label a GitHub issue with "ralphai" and Ralph will pick it up automatically.${RESET}`,
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Update logic — refresh template files while preserving user state
// ---------------------------------------------------------------------------

/** Files that are copied from templates and safe to overwrite on update. */
const TEMPLATE_FILES = ["ralph.sh", "README.md", "WRITING-PLANS.md"] as const;

async function updateRalph(options: RalphOptions, cwd: string): Promise<void> {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(__dir, "..", "templates", "ralph");
  const ralphDir = join(cwd, ".ralph");

  if (!options.yes) {
    clack.intro("Updating Ralph — refreshing template files");

    const confirmed = await clack.confirm({
      message:
        "This will overwrite ralph.sh, README.md, and WRITING-PLANS.md " +
        "from the latest templates. Your config, LEARNINGS.md, and plan " +
        "files will be preserved. Continue?",
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      clack.cancel("Update cancelled.");
      return;
    }
  }

  const updated: string[] = [];
  const skipped: string[] = [];

  // Update template files
  for (const file of TEMPLATE_FILES) {
    const src = join(templatesDir, file);
    const dest = join(ralphDir, file);
    copyFileSync(src, dest);
    if (file === "ralph.sh") {
      chmodSync(dest, 0o755);
    }
    updated.push(file);
  }

  // Report what was preserved
  for (const file of ["ralph.config", "LEARNINGS.md", ".gitignore"]) {
    if (existsSync(join(ralphDir, file))) {
      skipped.push(file);
    }
  }
  for (const subdir of ["backlog", "drafts", "in-progress", "out"]) {
    if (existsSync(join(ralphDir, subdir))) {
      skipped.push(`${subdir}/`);
    }
  }

  // Print results
  console.log(`${TEXT}Ralph updated in .ralph/${RESET}`);
  console.log();
  if (updated.length > 0) {
    console.log(`${DIM}Updated:${RESET}`);
    for (const file of updated) {
      console.log(`  .ralph/${file}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`${DIM}Preserved:${RESET}`);
    for (const file of skipped) {
      console.log(`  .ralph/${file}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function showRalphHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai <command> [options]`);
  console.log();
  console.log(`${TEXT}Commands:${RESET}`);
  console.log(
    `  ${TEXT}init${RESET}        ${DIM}Set up Ralph in your project (interactive wizard)${RESET}`,
  );
  console.log(
    `  ${TEXT}run${RESET}         ${DIM}Start the Ralph task runner${RESET}`,
  );
  console.log(
    `  ${TEXT}update${RESET}      ${DIM}Refresh Ralph template files (preserves config & state)${RESET}`,
  );
  console.log(
    `  ${TEXT}uninstall${RESET}   ${DIM}Remove Ralph from your project${RESET}`,
  );
  console.log();
  console.log(
    `${DIM}Run 'ralphai <command> --help' for command-specific options.${RESET}`,
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runRalph(args: string[]): Promise<void> {
  const options = parseRalphOptions(args);
  const cwd = options.targetDir ? resolve(options.targetDir) : process.cwd();

  switch (options.subcommand) {
    case "init":
      await runRalphInit(options, cwd);
      break;
    case "update":
      await runRalphUpdate(options, cwd);
      break;
    case "uninstall":
      await uninstallRalph(options, cwd);
      break;
    case "run":
      runRalphRunner(options, cwd);
      break;
    default:
      showRalphHelp();
      break;
  }
}

async function runRalphInit(options: RalphOptions, cwd: string): Promise<void> {
  // Check if .ralph/ already exists
  if (existsSync(join(cwd, ".ralph"))) {
    if (options.force) {
      // --force: remove everything and re-scaffold from scratch
      if (!options.yes) {
        clack.intro("Force re-scaffolding Ralph");

        const confirmed = await clack.confirm({
          message:
            "This will DELETE .ralph/ entirely and re-scaffold from scratch. " +
            "Your config, LEARNINGS.md, and any plan files will be LOST. Continue?",
        });

        if (clack.isCancel(confirmed) || !confirmed) {
          clack.cancel("Force re-scaffold cancelled.");
          return;
        }
      }

      rmSync(join(cwd, ".ralph"), { recursive: true, force: true });
      // Fall through to normal scaffold below
    } else {
      console.error(
        `${TEXT}Error:${RESET} Ralph is already set up in this directory (.ralph/ exists).\n` +
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
      protectedBranches: "main,master",
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

async function runRalphUpdate(
  options: RalphOptions,
  cwd: string,
): Promise<void> {
  if (!existsSync(join(cwd, ".ralph"))) {
    console.error(
      `${TEXT}Error:${RESET} Ralph is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  await updateRalph(options, cwd);
}

/** Default iteration count when `npx ralphai run` is invoked without args. */
const DEFAULT_ITERATIONS = "10";

function runRalphRunner(options: RalphOptions, cwd: string): void {
  const ralphSh = join(cwd, ".ralph", "ralph.sh");

  if (!existsSync(ralphSh)) {
    console.error(
      `${TEXT}Error:${RESET} Ralph is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  const args =
    options.runArgs.length > 0 ? options.runArgs : [DEFAULT_ITERATIONS];
  const result = spawnSync(ralphSh, args, {
    cwd,
    stdio: "inherit",
  });

  process.exit(result.status ?? 1);
}

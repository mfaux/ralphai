import { detectRunTarget, type RunTarget } from "./target-detection.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RalphaiSubcommand =
  | "init"
  | "update"
  | "run"
  | "uninstall"
  | "status"
  | "stop"
  | "reset"
  | "clean"
  | "doctor"
  | "repos"
  | "config"
  | "seed";

export type WorktreeSubcommand = "run" | "list" | "clean";

export interface WorktreeOptions {
  subcommand: WorktreeSubcommand;
  plan?: string; // --plan=<file>
  dir?: string; // --dir=<path>
  runArgs: string[]; // passthrough args for the runner (--agent-command, etc.)
}

export interface RalphaiOptions {
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
  once: boolean; // --once (for status auto-watch)
  stopSlug?: string; // positional arg for `stop` subcommand
  runTarget?: RunTarget; // positional target for `run` (issue number, plan path, or auto)
  runArgs: string[];
  worktreeOptions?: WorktreeOptions;
  unknownFlags: string[];
}

export interface WizardAnswers {
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
// Options parsing
// ---------------------------------------------------------------------------

export const SUBCOMMANDS = new Set<RalphaiSubcommand>([
  "init",
  "update",
  "run",
  "uninstall",
  "status",
  "stop",
  "reset",
  "clean",
  "doctor",
  "repos",
  "config",
  "seed", // hidden — not listed in showRalphaiHelp()
]);

export function parseRalphaiOptions(args: string[]): RalphaiOptions {
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
  let runTarget: RunTarget | undefined;
  const capabilities: string[] = [];
  const checkCapabilities: string[] = [];
  let configKey: string | undefined;
  const runArgs: string[] = [];
  let worktreeOptions: WorktreeOptions | undefined;
  const unknownFlags: string[] = [];

  let collectingRunArgs = false;
  let collectingConfigArgs = false;
  let expectingRunTarget = false;
  let expectingStopSlug = false;
  let stopSlug: string | undefined;

  for (const arg of args) {
    // After `run` subcommand or `--`, collect remaining args for the runner
    if (collectingRunArgs) {
      if (arg === "--") continue; // skip bare `--` separator (still supported)
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
        // For `stop`, next positional is the plan slug
        if (subcommand === "stop") {
          expectingStopSlug = true;
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
    stopSlug,
    runTarget,
    runArgs,
    worktreeOptions,
    unknownFlags,
  };
}

export const WORKTREE_SUBCOMMANDS = new Set<WorktreeSubcommand>([
  "list",
  "clean",
]);

export function parseWorktreeArgs(args: string[]): WorktreeOptions {
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

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
  | "seed"
  | "hitl"
  | "worktree";

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
  unknownCommand?: string; // first positional arg that doesn't match a known subcommand
  unknownFlags: string[];
  hitlIssueNumber?: number; // positional arg for `hitl` subcommand
}

export interface WizardAnswers {
  agentCommand: string;
  setupCommand: string;
  baseBranch: string;
  feedbackCommands: string;
  prFeedbackCommands: string;
  autoCommit?: boolean;
  issueSource: "none" | "github";
  sandbox?: "none" | "docker";
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
  "hitl",
  "worktree", // removed — prints redirect guidance
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
  const unknownFlags: string[] = [];
  let unknownCommand: string | undefined;
  let hitlIssueNumber: number | undefined;

  let collectingRunArgs = false;
  let collectingConfigArgs = false;
  let collectingHitlArgs = false;
  let expectingRunTarget = false;
  let expectingStopSlug = false;
  let expectingHitlIssue = false;
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

    // After `hitl` subcommand, collect issue number and remaining args
    if (collectingHitlArgs) {
      if (arg === "--help" || arg === "-h") {
        // Let the main dispatcher handle --help
        continue;
      }
      if (expectingHitlIssue && !arg.startsWith("-")) {
        const num = parseInt(arg, 10);
        if (!Number.isNaN(num) && num > 0) {
          hitlIssueNumber = num;
          expectingHitlIssue = false;
        } else {
          unknownFlags.push(arg);
        }
        continue;
      }
      // Remaining args are passed through as runArgs (for config overrides)
      runArgs.push(arg);
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
        // For `hitl`, next positional is the issue number, then remaining are runArgs
        if (subcommand === "hitl") {
          collectingHitlArgs = true;
          expectingHitlIssue = true;
        }
      } else if (!subcommand) {
        // Positional arg before any recognized subcommand — unknown command
        unknownCommand = arg;
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
    unknownCommand,
    unknownFlags,
    hitlIssueNumber,
  };
}

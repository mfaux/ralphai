/**
 * Config CLI — thin wrapper around src/config.ts and src/show-config.ts
 * for shell callers.
 *
 * Usage:
 *   node config-cli.mjs <configFilePath> [--show-config] [--shell] [cliArgs...]
 *
 * Normal mode (JSON):
 *   Resolves config and writes JSON to stdout.
 *
 * --shell mode:
 *   Writes shell variable assignments to stdout (KEY='value' per line).
 *   Designed for `eval "$(node config-cli.mjs ... --shell)"`.
 *
 * --show-config mode:
 *   Writes the formatted show-config text to stdout and exits.
 *
 * Worktree info is passed via env vars:
 *   RALPHAI_IS_WORKTREE=true/false
 *   RALPHAI_MAIN_WORKTREE=/path/to/main
 *
 * Exit codes:
 *   0 — success
 *   1 — config error (message on stderr)
 *   2 — usage error
 */

import { existsSync } from "fs";
import {
  resolveConfig,
  parseCLIArgs,
  ConfigError,
  type RalphaiConfig,
} from "./config.ts";
import { formatShowConfig } from "./show-config.ts";

/** Escape a string value for safe inclusion in a shell single-quoted assignment. */
function shellEscape(val: string): string {
  // In single quotes, the only character that needs escaping is ' itself.
  // Replace ' with '\'' (end quote, escaped quote, start quote).
  return val.replace(/'/g, "'\\''");
}

/** Map of config keys to their shell variable names. */
const CONFIG_TO_SHELL: ReadonlyArray<[keyof RalphaiConfig, string]> = [
  ["agentCommand", "AGENT_COMMAND"],
  ["feedbackCommands", "FEEDBACK_COMMANDS"],
  ["baseBranch", "BASE_BRANCH"],
  ["maxStuck", "MAX_STUCK"],
  ["mode", "MODE"],
  ["issueSource", "ISSUE_SOURCE"],
  ["issueLabel", "ISSUE_LABEL"],
  ["issueInProgressLabel", "ISSUE_IN_PROGRESS_LABEL"],
  ["issueRepo", "ISSUE_REPO"],
  ["issueCommentProgress", "ISSUE_COMMENT_PROGRESS"],
  ["turnTimeout", "TURN_TIMEOUT"],
  ["promptMode", "PROMPT_MODE"],
  ["continuous", "CONTINUOUS"],
  ["autoCommit", "AUTO_COMMIT"],
  ["turns", "TURNS"],
  ["maxLearnings", "MAX_LEARNINGS"],
];

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write(
    "Usage: config-cli <configFilePath> [--show-config] [--shell] [cliArgs...]\n",
  );
  process.exit(2);
}

// args[0] is guaranteed to exist by the length check above
const configFilePath: string = args[0]!;
const cliArgs = args.slice(1);

// Detect mode flags
const showConfig = cliArgs.includes("--show-config");
const shellMode = cliArgs.includes("--shell");

// Filter out mode flags and non-config flags before passing to config resolver
const configArgs = cliArgs.filter(
  (a) =>
    a !== "--show-config" &&
    a !== "--shell" &&
    a !== "--dry-run" &&
    a !== "-n" &&
    a !== "--resume" &&
    a !== "-r" &&
    a !== "--allow-dirty" &&
    a !== "--help" &&
    a !== "-h",
);

try {
  const result = resolveConfig({
    configFilePath,
    envVars: process.env as Record<string, string | undefined>,
    cliArgs: configArgs,
  });

  // Print warnings to stderr
  for (const w of result.warnings) {
    process.stderr.write(w + "\n");
  }

  if (showConfig) {
    const { rawFlags } = parseCLIArgs(configArgs);

    const worktreeEnv = process.env.RALPHAI_IS_WORKTREE;
    const mainWorktreeEnv = process.env.RALPHAI_MAIN_WORKTREE;
    const worktree =
      worktreeEnv === "true" && mainWorktreeEnv
        ? { isWorktree: true, mainWorktree: mainWorktreeEnv }
        : undefined;

    const text = formatShowConfig({
      config: result.config,
      configFilePath,
      configFileExists: existsSync(configFilePath),
      envVars: process.env as Record<string, string | undefined>,
      rawFlags,
      worktree,
      workspaces: result.config.workspaces.value,
    });

    process.stdout.write(text + "\n");
    process.exit(0);
  }

  if (shellMode) {
    // Output shell variable assignments for eval
    const lines: string[] = [];
    for (const [key, shellVar] of CONFIG_TO_SHELL) {
      const val = String(result.config[key].value ?? "");
      lines.push(`${shellVar}='${shellEscape(val)}'`);
    }
    // Workspaces: store as raw JSON string for scope resolution
    const ws = result.config.workspaces.value;
    if (ws) {
      lines.push(`CONFIG_WORKSPACES='${shellEscape(JSON.stringify(ws))}'`);
    }
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  }

  // JSON mode (default): output full JSON for programmatic consumption
  const config: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const key of Object.keys(result.config) as Array<keyof RalphaiConfig>) {
    config[key] = result.config[key].value;
    sources[key] = result.config[key].source;
  }

  const { rawFlags } = parseCLIArgs(configArgs);

  const output = {
    config,
    sources,
    warnings: result.warnings,
    rawFlags,
    configFileExists: existsSync(configFilePath),
  };

  process.stdout.write(JSON.stringify(output) + "\n");
} catch (e) {
  if (e instanceof ConfigError) {
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }
  throw e;
}

/**
 * Config CLI — thin wrapper around src/config.ts and src/show-config.ts
 * for shell callers.
 *
 * Usage:
 *   node config-cli.mjs <cwd> [--show-config] [--shell] [cliArgs...]
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
  configValues,
  parseCLIArgs,
  ConfigError,
} from "./config.ts";
import { formatShowConfig } from "./show-config.ts";

/** Escape a string value for safe inclusion in a shell single-quoted assignment. */
function shellEscape(val: string): string {
  // In single quotes, the only character that needs escaping is ' itself.
  // Replace ' with '\'' (end quote, escaped quote, start quote).
  return val.replace(/'/g, "'\\''");
}

/** Map of config paths to their shell variable names. */
const CONFIG_TO_SHELL: ReadonlyArray<
  [
    path: string,
    shellVar: string,
    getter: (cfg: ReturnType<typeof configValues>) => string | number | boolean,
  ]
> = [
  ["agent.command", "AGENT_COMMAND", (c) => c.agent.command],
  ["hooks.feedback", "FEEDBACK_COMMANDS", (c) => c.hooks.feedback],
  ["hooks.prFeedback", "PR_FEEDBACK_COMMANDS", (c) => c.hooks.prFeedback],
  ["baseBranch", "BASE_BRANCH", (c) => c.baseBranch],
  ["gate.maxStuck", "MAX_STUCK", (c) => c.gate.maxStuck],
  ["issue.source", "ISSUE_SOURCE", (c) => c.issue.source],
  ["issue.standaloneLabel", "STANDALONE_LABEL", (c) => c.issue.standaloneLabel],
  ["issue.subissueLabel", "SUBISSUE_LABEL", (c) => c.issue.subissueLabel],
  ["issue.prdLabel", "PRD_LABEL", (c) => c.issue.prdLabel],
  ["issue.repo", "ISSUE_REPO", (c) => c.issue.repo],
  [
    "issue.commentProgress",
    "ISSUE_COMMENT_PROGRESS",
    (c) => c.issue.commentProgress,
  ],
  [
    "gate.iterationTimeout",
    "ITERATION_TIMEOUT",
    (c) => c.gate.iterationTimeout,
  ],
  ["gate.review", "REVIEW", (c) => c.gate.review],
];

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write(
    "Usage: config-cli <cwd> [--show-config] [--shell] [cliArgs...]\n",
  );
  process.exit(2);
}

// args[0] is guaranteed to exist by the length check above
const cwd: string = args[0]!;
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
    cwd,
    envVars: process.env as Record<string, string | undefined>,
    cliArgs: configArgs,
  });

  const { configFilePath } = result;

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
      workspaces: configValues(result.config).workspaces,
    });

    process.stdout.write(text + "\n");
    process.exit(0);
  }

  if (shellMode) {
    // Output shell variable assignments for eval
    const cfg = configValues(result.config);
    const lines: string[] = [];
    for (const [, shellVar, getter] of CONFIG_TO_SHELL) {
      const val = String(getter(cfg) ?? "");
      lines.push(`${shellVar}='${shellEscape(val)}'`);
    }
    // Workspaces: store as raw JSON string for scope resolution
    const ws = cfg.workspaces;
    if (ws) {
      lines.push(`CONFIG_WORKSPACES='${shellEscape(JSON.stringify(ws))}'`);
    }
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  }

  // JSON mode (default): output full JSON for programmatic consumption
  const config: Record<string, unknown> = {};
  const sources: Record<string, unknown> = {};

  // Flatten the nested ResolvedConfig into dotted-key config/sources maps.
  // Groups (agent, hooks, ...) have nested { value, source } leaves;
  // flat top-level keys are directly { value, source }.
  const rc = result.config as unknown as Record<string, unknown>;
  for (const [key, entry] of Object.entries(rc)) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "value" in (entry as Record<string, unknown>) &&
      "source" in (entry as Record<string, unknown>)
    ) {
      // Flat top-level key (e.g. baseBranch, sandbox)
      const resolved = entry as { value: unknown; source: string };
      config[key] = resolved.value;
      sources[key] = resolved.source;
    } else if (entry !== null && typeof entry === "object") {
      // Group (e.g. agent, hooks, gate) — each property is { value, source }
      const group = entry as Record<string, { value: unknown; source: string }>;
      for (const [subKey, leaf] of Object.entries(group)) {
        config[`${key}.${subKey}`] = leaf.value;
        sources[`${key}.${subKey}`] = leaf.source;
      }
    }
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

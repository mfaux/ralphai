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
  const cfg = configValues(result.config);
  const config: Record<string, unknown> = {};
  const sources: Record<string, unknown> = {};

  // Output the nested structure directly
  config["agent.command"] = cfg.agent.command;
  config["agent.interactiveCommand"] = cfg.agent.interactiveCommand;
  config["agent.setupCommand"] = cfg.agent.setupCommand;
  config["hooks.feedback"] = cfg.hooks.feedback;
  config["hooks.prFeedback"] = cfg.hooks.prFeedback;
  config["hooks.beforeRun"] = cfg.hooks.beforeRun;
  config["hooks.afterRun"] = cfg.hooks.afterRun;
  config["hooks.feedbackTimeout"] = cfg.hooks.feedbackTimeout;
  config["gate.maxStuck"] = cfg.gate.maxStuck;
  config["gate.review"] = cfg.gate.review;
  config["gate.maxRejections"] = cfg.gate.maxRejections;
  config["gate.maxIterations"] = cfg.gate.maxIterations;
  config["gate.reviewMaxFiles"] = cfg.gate.reviewMaxFiles;
  config["gate.validators"] = cfg.gate.validators;
  config["gate.iterationTimeout"] = cfg.gate.iterationTimeout;
  config["prompt.verbose"] = cfg.prompt.verbose;
  config["prompt.preamble"] = cfg.prompt.preamble;
  config["prompt.learnings"] = cfg.prompt.learnings;
  config["prompt.commitStyle"] = cfg.prompt.commitStyle;
  config["pr.draft"] = cfg.pr.draft;
  config["git.branchPrefix"] = cfg.git.branchPrefix;
  config["issue.source"] = cfg.issue.source;
  config["issue.standaloneLabel"] = cfg.issue.standaloneLabel;
  config["issue.subissueLabel"] = cfg.issue.subissueLabel;
  config["issue.prdLabel"] = cfg.issue.prdLabel;
  config["issue.repo"] = cfg.issue.repo;
  config["issue.commentProgress"] = cfg.issue.commentProgress;
  config["issue.hitlLabel"] = cfg.issue.hitlLabel;
  config["issue.inProgressLabel"] = cfg.issue.inProgressLabel;
  config["issue.doneLabel"] = cfg.issue.doneLabel;
  config["issue.stuckLabel"] = cfg.issue.stuckLabel;
  config["baseBranch"] = cfg.baseBranch;
  config["sandbox"] = cfg.sandbox;
  config["dockerImage"] = cfg.dockerImage;
  config["dockerMounts"] = cfg.dockerMounts;
  config["dockerEnvVars"] = cfg.dockerEnvVars;
  config["workspaces"] = cfg.workspaces;

  sources["agent.command"] = result.config.agent.command.source;
  sources["agent.interactiveCommand"] =
    result.config.agent.interactiveCommand.source;
  sources["agent.setupCommand"] = result.config.agent.setupCommand.source;
  sources["hooks.feedback"] = result.config.hooks.feedback.source;
  sources["hooks.prFeedback"] = result.config.hooks.prFeedback.source;
  sources["hooks.beforeRun"] = result.config.hooks.beforeRun.source;
  sources["hooks.afterRun"] = result.config.hooks.afterRun.source;
  sources["hooks.feedbackTimeout"] = result.config.hooks.feedbackTimeout.source;
  sources["gate.maxStuck"] = result.config.gate.maxStuck.source;
  sources["gate.review"] = result.config.gate.review.source;
  sources["gate.maxRejections"] = result.config.gate.maxRejections.source;
  sources["gate.maxIterations"] = result.config.gate.maxIterations.source;
  sources["gate.reviewMaxFiles"] = result.config.gate.reviewMaxFiles.source;
  sources["gate.validators"] = result.config.gate.validators.source;
  sources["gate.iterationTimeout"] = result.config.gate.iterationTimeout.source;
  sources["prompt.verbose"] = result.config.prompt.verbose.source;
  sources["prompt.preamble"] = result.config.prompt.preamble.source;
  sources["prompt.learnings"] = result.config.prompt.learnings.source;
  sources["prompt.commitStyle"] = result.config.prompt.commitStyle.source;
  sources["pr.draft"] = result.config.pr.draft.source;
  sources["git.branchPrefix"] = result.config.git.branchPrefix.source;
  sources["issue.source"] = result.config.issue.source.source;
  sources["issue.standaloneLabel"] = result.config.issue.standaloneLabel.source;
  sources["issue.subissueLabel"] = result.config.issue.subissueLabel.source;
  sources["issue.prdLabel"] = result.config.issue.prdLabel.source;
  sources["issue.repo"] = result.config.issue.repo.source;
  sources["issue.commentProgress"] = result.config.issue.commentProgress.source;
  sources["issue.hitlLabel"] = result.config.issue.hitlLabel.source;
  sources["issue.inProgressLabel"] = result.config.issue.inProgressLabel.source;
  sources["issue.doneLabel"] = result.config.issue.doneLabel.source;
  sources["issue.stuckLabel"] = result.config.issue.stuckLabel.source;
  sources["baseBranch"] = result.config.baseBranch.source;
  sources["sandbox"] = result.config.sandbox.source;
  sources["dockerImage"] = result.config.dockerImage.source;
  sources["dockerMounts"] = result.config.dockerMounts.source;
  sources["dockerEnvVars"] = result.config.dockerEnvVars.source;
  sources["workspaces"] = result.config.workspaces.source;

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

/**
 * show-config.ts — Formats the --show-config output.
 */

import type {
  ResolvedConfig,
  RalphaiConfig,
  WorkspaceOverrides,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Agent type detection
// ---------------------------------------------------------------------------

const AGENT_PATTERNS: ReadonlyArray<[pattern: string, type: string]> = [
  ["claude", "claude"],
  ["opencode", "opencode"],
  ["codex", "codex"],
  ["gemini", "gemini"],
  ["aider", "aider"],
  ["goose", "goose"],
  ["kiro", "kiro"],
  ["amp", "amp"],
];

/**
 * Detect the agent type from the agent command string.
 */
export function detectAgentType(agentCommand: string): string {
  if (!agentCommand) return "unknown";
  const lower = agentCommand.toLowerCase();
  for (const [pattern, type] of AGENT_PATTERNS) {
    if (lower.includes(pattern)) return type;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Source label formatting
// ---------------------------------------------------------------------------

/** Env var name for each config key. */
const CONFIG_KEY_TO_ENV: Readonly<Record<string, string>> = {
  agentCommand: "RALPHAI_AGENT_COMMAND",
  setupCommand: "RALPHAI_SETUP_COMMAND",
  feedbackCommands: "RALPHAI_FEEDBACK_COMMANDS",
  baseBranch: "RALPHAI_BASE_BRANCH",
  maxStuck: "RALPHAI_MAX_STUCK",
  iterationTimeout: "RALPHAI_ITERATION_TIMEOUT",
  issueSource: "RALPHAI_ISSUE_SOURCE",
  issueLabel: "RALPHAI_ISSUE_LABEL",
  issueInProgressLabel: "RALPHAI_ISSUE_IN_PROGRESS_LABEL",
  issueDoneLabel: "RALPHAI_ISSUE_DONE_LABEL",
  issueRepo: "RALPHAI_ISSUE_REPO",
  issueCommentProgress: "RALPHAI_ISSUE_COMMENT_PROGRESS",
  autoCommit: "RALPHAI_AUTO_COMMIT",
};

// ---------------------------------------------------------------------------
// Format show-config output
// ---------------------------------------------------------------------------

export interface FormatShowConfigInput {
  config: ResolvedConfig;
  configFilePath: string;
  configFileExists: boolean;
  envVars: Record<string, string | undefined>;
  rawFlags: Partial<Record<keyof RalphaiConfig, string>>;
  worktree?: { isWorktree: boolean; mainWorktree: string };
  /** Workspaces JSON as parsed from config file (for display). */
  workspaces: Record<string, WorkspaceOverrides> | null;
}

/**
 * Build the source label for a single config field.
 */
function sourceLabel(
  key: keyof RalphaiConfig,
  source: string,
  input: FormatShowConfigInput,
  defaultLabel?: string,
): string {
  if (source === "cli") {
    const raw = input.rawFlags[key];
    return raw ? `cli (${raw})` : "cli";
  }
  if (source === "env") {
    const envName = CONFIG_KEY_TO_ENV[key];
    if (envName) {
      const envVal = input.envVars[envName];
      return `env (${envName}=${envVal ?? ""})`;
    }
    return "env";
  }
  if (source === "config") {
    return `config (${input.configFilePath})`;
  }
  // default
  return defaultLabel ? `default (${defaultLabel})` : "default";
}

/**
 * Format the full --show-config output string.
 */
export function formatShowConfig(input: FormatShowConfigInput): string {
  const { config, configFilePath, configFileExists, worktree, workspaces } =
    input;
  const lines: string[] = [];

  lines.push("Resolved settings (precedence: CLI > env > config > defaults):");
  lines.push("");

  // --- Setting lines ---
  // Each line: "  <name padded> = <value>  (<source>)"
  // Field names are manually aligned to match the shell output exactly.

  const agentCmd = config.agentCommand.value;
  const agentCmdDisplay = agentCmd || "<none>";
  const agentSrc = sourceLabel(
    "agentCommand",
    config.agentCommand.source,
    input,
    "none",
  );
  lines.push(`  agentCommand       = ${agentCmdDisplay}  (${agentSrc})`);

  const setupCmd = config.setupCommand.value;
  const setupCmdDisplay = setupCmd || "<none>";
  const setupSrc = sourceLabel(
    "setupCommand",
    config.setupCommand.source,
    input,
    "none",
  );
  lines.push(`  setupCommand       = ${setupCmdDisplay}  (${setupSrc})`);

  const feedbackCmd = config.feedbackCommands.value;
  const feedbackDisplay = feedbackCmd || "<none>";
  const feedbackSrc = sourceLabel(
    "feedbackCommands",
    config.feedbackCommands.source,
    input,
    "none",
  );
  lines.push(`  feedbackCommands   = ${feedbackDisplay}  (${feedbackSrc})`);

  const baseBranchSrc = sourceLabel(
    "baseBranch",
    config.baseBranch.source,
    input,
  );
  lines.push(
    `  baseBranch         = ${config.baseBranch.value}  (${baseBranchSrc})`,
  );

  // autoCommit: CLI label is "--auto-commit" or "--no-auto-commit"
  const autoCommitSrc = sourceLabel(
    "autoCommit",
    config.autoCommit.source,
    input,
  );
  lines.push(
    `  autoCommit         = ${config.autoCommit.value}  (${autoCommitSrc})`,
  );

  const maxStuckSrc = sourceLabel("maxStuck", config.maxStuck.source, input);
  lines.push(
    `  maxStuck           = ${config.maxStuck.value}  (${maxStuckSrc})`,
  );

  // iterationTimeout: 0 displays as "off", otherwise "<N>s"
  const timeoutVal = config.iterationTimeout.value;
  const timeoutDisplay = timeoutVal > 0 ? `${timeoutVal}s` : "off";
  const timeoutSrc = sourceLabel(
    "iterationTimeout",
    config.iterationTimeout.source,
    input,
  );
  lines.push(`  iterationTimeout   = ${timeoutDisplay}  (${timeoutSrc})`);

  const issueSourceSrc = sourceLabel(
    "issueSource",
    config.issueSource.source,
    input,
  );
  lines.push(
    `  issueSource        = ${config.issueSource.value}  (${issueSourceSrc})`,
  );

  // Conditional issue settings (only shown when issueSource != "none")
  if (config.issueSource.value !== "none") {
    const issueLabelSrc = sourceLabel(
      "issueLabel",
      config.issueLabel.source,
      input,
    );
    lines.push(
      `  issueLabel         = ${config.issueLabel.value}  (${issueLabelSrc})`,
    );

    const issueIpSrc = sourceLabel(
      "issueInProgressLabel",
      config.issueInProgressLabel.source,
      input,
    );
    lines.push(
      `  issueInProgressLabel = ${config.issueInProgressLabel.value}  (${issueIpSrc})`,
    );

    const issueDoneSrc = sourceLabel(
      "issueDoneLabel",
      config.issueDoneLabel.source,
      input,
    );
    lines.push(
      `  issueDoneLabel     = ${config.issueDoneLabel.value}  (${issueDoneSrc})`,
    );

    const issueRepoVal = config.issueRepo.value || "<auto-detect>";
    const issueRepoSrc = sourceLabel(
      "issueRepo",
      config.issueRepo.source,
      input,
      "auto-detect",
    );
    lines.push(`  issueRepo          = ${issueRepoVal}  (${issueRepoSrc})`);

    const issueCommentSrc = sourceLabel(
      "issueCommentProgress",
      config.issueCommentProgress.source,
      input,
    );
    lines.push(
      `  issueCommentProgress = ${config.issueCommentProgress.value}  (${issueCommentSrc})`,
    );
  }

  lines.push("");

  // Detected agent type
  if (agentCmd) {
    const agentType = detectAgentType(agentCmd);
    lines.push(`  detectedAgentType  = ${agentType}`);
  } else {
    lines.push("  detectedAgentType  = <no agentCommand set>");
  }

  lines.push("");

  // Worktree info
  if (worktree?.isWorktree) {
    lines.push("  worktree           = true");
    lines.push(`  mainWorktree       = ${worktree.mainWorktree}`);
    lines.push("");
  }

  // Config file status
  if (configFileExists) {
    lines.push(`Config file: ${configFilePath} (loaded)`);
    if (workspaces && Object.keys(workspaces).length > 0) {
      lines.push("");
      lines.push("Workspaces (per-package overrides):");
      for (const [pkg, overrides] of Object.entries(workspaces)) {
        const fc = overrides.feedbackCommands;
        let fcDisplay: string;
        if (fc == null) {
          fcDisplay = "none";
        } else if (Array.isArray(fc)) {
          fcDisplay = fc.join(", ");
        } else {
          fcDisplay = String(fc);
        }
        lines.push(`  ${pkg}: feedbackCommands=${fcDisplay}`);
      }
    }
  } else {
    lines.push(`Config file: ${configFilePath} (not found, using defaults)`);
  }

  return lines.join("\n");
}

/**
 * show-config.ts — Formats the --show-config output.
 */

import type { ResolvedConfig, WorkspaceOverrides } from "./config.ts";

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
 *
 * Only the binary/command portion (first token) is matched so that flag
 * values like `--model github-copilot/claude-opus-4` don't cause a
 * false match.
 */
export function detectAgentType(agentCommand: string): string {
  if (!agentCommand) return "unknown";
  // Extract the first token (the binary name) and match against that.
  const binary = (agentCommand.trim().split(/\s+/)[0] ?? "").toLowerCase();
  for (const [pattern, type] of AGENT_PATTERNS) {
    if (binary.includes(pattern)) return type;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Source label formatting
// ---------------------------------------------------------------------------

/** Env var name for each config path (dot-notation). */
const CONFIG_PATH_TO_ENV: Readonly<Record<string, string>> = {
  "agent.command": "RALPHAI_AGENT_COMMAND",
  "agent.setupCommand": "RALPHAI_AGENT_SETUP_COMMAND",
  "agent.interactiveCommand": "RALPHAI_AGENT_INTERACTIVE_COMMAND",
  "hooks.feedback": "RALPHAI_HOOKS_FEEDBACK",
  "hooks.prFeedback": "RALPHAI_HOOKS_PR_FEEDBACK",
  "hooks.beforeRun": "RALPHAI_HOOKS_BEFORE_RUN",
  "hooks.afterRun": "RALPHAI_HOOKS_AFTER_RUN",
  "hooks.feedbackTimeout": "RALPHAI_HOOKS_FEEDBACK_TIMEOUT",
  "gate.maxStuck": "RALPHAI_GATE_MAX_STUCK",
  "gate.review": "RALPHAI_GATE_REVIEW",
  "gate.maxRejections": "RALPHAI_GATE_MAX_REJECTIONS",
  "gate.maxIterations": "RALPHAI_GATE_MAX_ITERATIONS",
  "gate.reviewMaxFiles": "RALPHAI_GATE_REVIEW_MAX_FILES",
  "gate.validators": "RALPHAI_GATE_VALIDATORS",
  "gate.iterationTimeout": "RALPHAI_GATE_ITERATION_TIMEOUT",
  "prompt.verbose": "RALPHAI_PROMPT_VERBOSE",
  "prompt.preamble": "RALPHAI_PROMPT_PREAMBLE",
  "prompt.learnings": "RALPHAI_PROMPT_LEARNINGS",
  "prompt.commitStyle": "RALPHAI_PROMPT_COMMIT_STYLE",
  "pr.draft": "RALPHAI_PR_DRAFT",
  "git.branchPrefix": "RALPHAI_GIT_BRANCH_PREFIX",
  "issue.source": "RALPHAI_ISSUE_SOURCE",
  "issue.standaloneLabel": "RALPHAI_ISSUE_STANDALONE_LABEL",
  "issue.subissueLabel": "RALPHAI_ISSUE_SUBISSUE_LABEL",
  "issue.prdLabel": "RALPHAI_ISSUE_PRD_LABEL",
  "issue.repo": "RALPHAI_ISSUE_REPO",
  "issue.commentProgress": "RALPHAI_ISSUE_COMMENT_PROGRESS",
  "issue.hitlLabel": "RALPHAI_ISSUE_HITL_LABEL",
  "issue.inProgressLabel": "RALPHAI_ISSUE_IN_PROGRESS_LABEL",
  "issue.doneLabel": "RALPHAI_ISSUE_DONE_LABEL",
  "issue.stuckLabel": "RALPHAI_ISSUE_STUCK_LABEL",
  baseBranch: "RALPHAI_BASE_BRANCH",
  sandbox: "RALPHAI_SANDBOX",
  dockerImage: "RALPHAI_DOCKER_IMAGE",
  dockerMounts: "RALPHAI_DOCKER_MOUNTS",
  dockerEnvVars: "RALPHAI_DOCKER_ENV_VARS",
};

// ---------------------------------------------------------------------------
// Format show-config output
// ---------------------------------------------------------------------------

export interface FormatShowConfigInput {
  config: ResolvedConfig;
  configFilePath: string;
  configFileExists: boolean;
  envVars: Record<string, string | undefined>;
  rawFlags: Record<string, string>;
  worktree?: { isWorktree: boolean; mainWorktree: string };
  /** Workspaces JSON as parsed from config file (for display). */
  workspaces: Record<string, WorkspaceOverrides> | null;
}

/**
 * Build the source label for a single config field.
 */
function sourceLabel(
  configPath: string,
  source: string,
  input: FormatShowConfigInput,
  defaultLabel?: string,
): string {
  if (source === "cli") {
    const raw = input.rawFlags[configPath];
    return raw ? `cli (${raw})` : "cli";
  }
  if (source === "env") {
    const envName = CONFIG_PATH_TO_ENV[configPath];
    if (envName) {
      const envVal = input.envVars[envName];
      return `env (${envName}=${envVal ?? ""})`;
    }
    return "env";
  }
  if (source === "config") {
    return `config (${input.configFilePath})`;
  }
  if (source === "auto-detected") {
    return "auto-detected";
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

  const agentCmd = config.agent.command.value;
  const agentCmdDisplay = agentCmd || "<none>";
  const agentSrc = sourceLabel(
    "agent.command",
    config.agent.command.source,
    input,
    "none",
  );
  lines.push(`  agent.command      = ${agentCmdDisplay}  (${agentSrc})`);

  const agentInteractiveCmd = config.agent.interactiveCommand.value;
  const agentInteractiveCmdDisplay = agentInteractiveCmd || "<none>";
  const agentInteractiveSrc = sourceLabel(
    "agent.interactiveCommand",
    config.agent.interactiveCommand.source,
    input,
    "none",
  );
  lines.push(
    `  agent.interactiveCommand = ${agentInteractiveCmdDisplay}  (${agentInteractiveSrc})`,
  );

  const setupCmd = config.agent.setupCommand.value;
  const setupCmdDisplay = setupCmd || "<none>";
  const setupSrc = sourceLabel(
    "agent.setupCommand",
    config.agent.setupCommand.source,
    input,
    "none",
  );
  lines.push(`  agent.setupCommand = ${setupCmdDisplay}  (${setupSrc})`);

  const feedbackCmd = config.hooks.feedback.value;
  const feedbackDisplay = feedbackCmd || "<none>";
  const feedbackSrc = sourceLabel(
    "hooks.feedback",
    config.hooks.feedback.source,
    input,
    "none",
  );
  lines.push(`  hooks.feedback     = ${feedbackDisplay}  (${feedbackSrc})`);

  const prFeedbackCmd = config.hooks.prFeedback.value;
  const prFeedbackDisplay = prFeedbackCmd || "<none>";
  const prFeedbackSrc = sourceLabel(
    "hooks.prFeedback",
    config.hooks.prFeedback.source,
    input,
    "none",
  );
  lines.push(`  hooks.prFeedback   = ${prFeedbackDisplay}  (${prFeedbackSrc})`);

  const baseBranchSrc = sourceLabel(
    "baseBranch",
    config.baseBranch.source,
    input,
  );
  lines.push(
    `  baseBranch         = ${config.baseBranch.value}  (${baseBranchSrc})`,
  );

  const sandboxSrc = sourceLabel("sandbox", config.sandbox.source, input);
  lines.push(`  sandbox            = ${config.sandbox.value}  (${sandboxSrc})`);

  // Docker config keys (shown when sandbox is "docker" or explicitly set)
  if (
    config.sandbox.value === "docker" ||
    config.dockerImage.source !== "default" ||
    config.dockerMounts.source !== "default" ||
    config.dockerEnvVars.source !== "default"
  ) {
    const dockerImageVal = config.dockerImage.value || "<auto-resolve>";
    const dockerImageSrc = sourceLabel(
      "dockerImage",
      config.dockerImage.source,
      input,
      "auto-resolve",
    );
    lines.push(`  dockerImage        = ${dockerImageVal}  (${dockerImageSrc})`);

    const dockerMountsVal = config.dockerMounts.value || "<none>";
    const dockerMountsSrc = sourceLabel(
      "dockerMounts",
      config.dockerMounts.source,
      input,
      "none",
    );
    lines.push(
      `  dockerMounts       = ${dockerMountsVal}  (${dockerMountsSrc})`,
    );

    const dockerEnvVarsVal = config.dockerEnvVars.value || "<none>";
    const dockerEnvVarsSrc = sourceLabel(
      "dockerEnvVars",
      config.dockerEnvVars.source,
      input,
      "none",
    );
    lines.push(
      `  dockerEnvVars      = ${dockerEnvVarsVal}  (${dockerEnvVarsSrc})`,
    );
  }

  // gate.review
  const reviewSrc = sourceLabel(
    "gate.review",
    config.gate.review.source,
    input,
  );
  lines.push(
    `  gate.review        = ${config.gate.review.value}  (${reviewSrc})`,
  );

  // prompt.verbose
  const verboseSrc = sourceLabel(
    "prompt.verbose",
    config.prompt.verbose.source,
    input,
  );
  lines.push(
    `  prompt.verbose     = ${config.prompt.verbose.value}  (${verboseSrc})`,
  );

  const maxStuckSrc = sourceLabel(
    "gate.maxStuck",
    config.gate.maxStuck.source,
    input,
  );
  lines.push(
    `  gate.maxStuck      = ${config.gate.maxStuck.value}  (${maxStuckSrc})`,
  );

  // gate.iterationTimeout: 0 displays as "off", otherwise "<N>s"
  const timeoutVal = config.gate.iterationTimeout.value;
  const timeoutDisplay = timeoutVal > 0 ? `${timeoutVal}s` : "off";
  const timeoutSrc = sourceLabel(
    "gate.iterationTimeout",
    config.gate.iterationTimeout.source,
    input,
  );
  lines.push(`  gate.iterationTimeout = ${timeoutDisplay}  (${timeoutSrc})`);

  const issueSourceSrc = sourceLabel(
    "issue.source",
    config.issue.source.source,
    input,
  );
  lines.push(
    `  issue.source       = ${config.issue.source.value}  (${issueSourceSrc})`,
  );

  // Conditional issue settings (only shown when issue.source != "none")
  if (config.issue.source.value !== "none") {
    const standaloneLabelSrc = sourceLabel(
      "issue.standaloneLabel",
      config.issue.standaloneLabel.source,
      input,
    );
    lines.push(
      `  issue.standaloneLabel = ${config.issue.standaloneLabel.value}  (${standaloneLabelSrc})`,
    );

    const subissueLabelSrc = sourceLabel(
      "issue.subissueLabel",
      config.issue.subissueLabel.source,
      input,
    );
    lines.push(
      `  issue.subissueLabel = ${config.issue.subissueLabel.value}  (${subissueLabelSrc})`,
    );

    const prdLabelSrc = sourceLabel(
      "issue.prdLabel",
      config.issue.prdLabel.source,
      input,
    );
    lines.push(
      `  issue.prdLabel     = ${config.issue.prdLabel.value}  (${prdLabelSrc})`,
    );

    const issueRepoVal = config.issue.repo.value || "<auto-detect>";
    const issueRepoSrc = sourceLabel(
      "issue.repo",
      config.issue.repo.source,
      input,
      "auto-detect",
    );
    lines.push(`  issue.repo         = ${issueRepoVal}  (${issueRepoSrc})`);

    const issueCommentSrc = sourceLabel(
      "issue.commentProgress",
      config.issue.commentProgress.source,
      input,
    );
    lines.push(
      `  issue.commentProgress = ${config.issue.commentProgress.value}  (${issueCommentSrc})`,
    );

    const issueHitlLabelSrc = sourceLabel(
      "issue.hitlLabel",
      config.issue.hitlLabel.source,
      input,
    );
    lines.push(
      `  issue.hitlLabel    = ${config.issue.hitlLabel.value}  (${issueHitlLabelSrc})`,
    );
  }

  lines.push("");

  // Detected agent type
  if (agentCmd) {
    const agentType = detectAgentType(agentCmd);
    lines.push(`  detectedAgentType  = ${agentType}`);
  } else {
    lines.push("  detectedAgentType  = <no agent.command set>");
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
      const fmtList = (v: unknown): string =>
        v == null ? "none" : Array.isArray(v) ? v.join(", ") : String(v);
      for (const [pkg, overrides] of Object.entries(workspaces)) {
        lines.push(
          `  ${pkg}: feedbackCommands=${fmtList(overrides.feedbackCommands)}`,
        );
        lines.push(
          `  ${pkg}: prFeedbackCommands=${fmtList(overrides.prFeedbackCommands)}`,
        );
      }
    }
  } else {
    lines.push(`Config file: ${configFilePath} (not found, using defaults)`);
  }

  return lines.join("\n");
}

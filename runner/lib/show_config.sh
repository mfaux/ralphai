# show_config.sh — --show-config display logic.
# Sourced by ralphai.sh after cli.sh. Runs at source-time.
# Depends on: validate.sh (detect_agent_type), config.sh (CONFIG_* vars),
#             cli.sh (CLI_* vars, SHOW_CONFIG flag)

# _setting_source <cli_var_value> <env_var_name> <config_var_value> <cli_label> [default_label]
# Prints the source of a resolved setting: "cli (...)", "env (...)", "config (...)", or "default [(...)]"
_setting_source() {
  local cli_val="$1" env_name="$2" config_val="$3" cli_label="$4" default_label="${5:-}"
  local env_val="${!env_name:-}"
  if [[ -n "$cli_val" ]]; then
    echo "cli ($cli_label)"
  elif [[ -n "$env_val" ]]; then
    echo "env ($env_name=$env_val)"
  elif [[ -n "$config_val" ]]; then
    echo "config ($CONFIG_FILE)"
  else
    if [[ -n "$default_label" ]]; then
      echo "default ($default_label)"
    else
      echo "default"
    fi
  fi
}

# --- Show resolved config and exit ---
if [[ "$SHOW_CONFIG" == true ]]; then
  echo "Resolved settings (precedence: CLI > env > config > defaults):"
  echo ""

  # Determine source for each setting
  agent_command_source=$(_setting_source "$CLI_AGENT_COMMAND" "RALPHAI_AGENT_COMMAND" "${CONFIG_AGENT_COMMAND:-}" "--agent-command=$CLI_AGENT_COMMAND" "none")
  feedback_commands_source=$(_setting_source "$CLI_FEEDBACK_COMMANDS" "RALPHAI_FEEDBACK_COMMANDS" "${CONFIG_FEEDBACK_COMMANDS:-}" "--feedback-commands=$CLI_FEEDBACK_COMMANDS" "none")
  branch_source=$(_setting_source "$CLI_BASE_BRANCH" "RALPHAI_BASE_BRANCH" "${CONFIG_BASE_BRANCH:-}" "--base-branch=$CLI_BASE_BRANCH")
  stuck_source=$(_setting_source "$CLI_MAX_STUCK" "RALPHAI_MAX_STUCK" "${CONFIG_MAX_STUCK:-}" "--max-stuck=$CLI_MAX_STUCK")

  # mode: CLI label uses resolved MODE value, not CLI_MODE
  if [[ -n "$CLI_MODE" ]]; then
    mode_source="cli (--${MODE})"
  elif [[ -n "${RALPHAI_MODE:-}" ]]; then
    mode_source="env (RALPHAI_MODE=$RALPHAI_MODE)"
  elif [[ -n "${CONFIG_MODE:-}" ]]; then
    mode_source="config ($CONFIG_FILE)"
  else
    mode_source="default"
  fi

  # continuous: CLI label is just "--continuous" (no =value)
  if [[ -n "$CLI_CONTINUOUS" ]]; then
    continuous_source="cli (--continuous)"
  elif [[ -n "${RALPHAI_CONTINUOUS:-}" ]]; then
    continuous_source="env (RALPHAI_CONTINUOUS=$RALPHAI_CONTINUOUS)"
  elif [[ -n "${CONFIG_CONTINUOUS:-}" ]]; then
    continuous_source="config ($CONFIG_FILE)"
  else
    continuous_source="default"
  fi

  timeout_source=$(_setting_source "$CLI_TURN_TIMEOUT" "RALPHAI_TURN_TIMEOUT" "${CONFIG_TURN_TIMEOUT:-}" "--turn-timeout=$CLI_TURN_TIMEOUT")
  issue_source_source=$(_setting_source "$CLI_ISSUE_SOURCE" "RALPHAI_ISSUE_SOURCE" "${CONFIG_ISSUE_SOURCE:-}" "--issue-source=$CLI_ISSUE_SOURCE")
  issue_label_source=$(_setting_source "$CLI_ISSUE_LABEL" "RALPHAI_ISSUE_LABEL" "${CONFIG_ISSUE_LABEL:-}" "--issue-label=$CLI_ISSUE_LABEL")
  issue_ip_label_source=$(_setting_source "$CLI_ISSUE_IN_PROGRESS_LABEL" "RALPHAI_ISSUE_IN_PROGRESS_LABEL" "${CONFIG_ISSUE_IN_PROGRESS_LABEL:-}" "--issue-in-progress-label=$CLI_ISSUE_IN_PROGRESS_LABEL")
  issue_repo_source=$(_setting_source "$CLI_ISSUE_REPO" "RALPHAI_ISSUE_REPO" "${CONFIG_ISSUE_REPO:-}" "--issue-repo=$CLI_ISSUE_REPO" "auto-detect")
  issue_close_source=$(_setting_source "$CLI_ISSUE_CLOSE_ON_COMPLETE" "RALPHAI_ISSUE_CLOSE_ON_COMPLETE" "${CONFIG_ISSUE_CLOSE_ON_COMPLETE:-}" "--issue-close-on-complete=$CLI_ISSUE_CLOSE_ON_COMPLETE")
  issue_comment_source=$(_setting_source "$CLI_ISSUE_COMMENT_PROGRESS" "RALPHAI_ISSUE_COMMENT_PROGRESS" "${CONFIG_ISSUE_COMMENT_PROGRESS:-}" "--issue-comment-progress=$CLI_ISSUE_COMMENT_PROGRESS")
  prompt_mode_source=$(_setting_source "$CLI_PROMPT_MODE" "RALPHAI_PROMPT_MODE" "${CONFIG_PROMPT_MODE:-}" "--prompt-mode=$CLI_PROMPT_MODE")
  fallback_agents_source=$(_setting_source "$CLI_FALLBACK_AGENTS" "RALPHAI_FALLBACK_AGENTS" "${CONFIG_FALLBACK_AGENTS:-}" "--fallback-agents=$CLI_FALLBACK_AGENTS" "none")

  # auto_commit: special-case --no-auto-commit vs --auto-commit CLI label
  if [[ -n "$CLI_AUTO_COMMIT" ]]; then
    if [[ "$CLI_AUTO_COMMIT" == "false" ]]; then
      auto_commit_source="cli (--no-auto-commit)"
    else
      auto_commit_source="cli (--auto-commit)"
    fi
  elif [[ -n "${RALPHAI_AUTO_COMMIT:-}" ]]; then
    auto_commit_source="env (RALPHAI_AUTO_COMMIT=$RALPHAI_AUTO_COMMIT)"
  elif [[ -n "${CONFIG_AUTO_COMMIT:-}" ]]; then
    auto_commit_source="config ($CONFIG_FILE)"
  else
    auto_commit_source="default"
  fi

  turns_source=$(_setting_source "$CLI_TURNS" "RALPHAI_TURNS" "${CONFIG_TURNS:-}" "--turns=$CLI_TURNS")

  echo "  agentCommand       = ${AGENT_COMMAND:-<none>}  ($agent_command_source)"
  echo "  feedbackCommands   = ${FEEDBACK_COMMANDS:-<none>}  ($feedback_commands_source)"
  echo "  baseBranch         = $BASE_BRANCH  ($branch_source)"
  echo "  mode               = $MODE  ($mode_source)"
  echo "  continuous         = $CONTINUOUS  ($continuous_source)"
  echo "  autoCommit         = $AUTO_COMMIT  ($auto_commit_source)"
  if [[ "$TURNS" -eq 0 ]]; then
    echo "  turns              = unlimited  ($turns_source)"
  else
    echo "  turns              = $TURNS  ($turns_source)"
  fi
  echo "  maxStuck           = $MAX_STUCK  ($stuck_source)"
  if [[ "$TURN_TIMEOUT" -gt 0 ]]; then
    echo "  turnTimeout        = ${TURN_TIMEOUT}s  ($timeout_source)"
  else
    echo "  turnTimeout        = off  ($timeout_source)"
  fi
  echo "  promptMode         = $PROMPT_MODE  ($prompt_mode_source)"
  echo "  fallbackAgents     = ${FALLBACK_AGENTS:-<none>}  ($fallback_agents_source)"
  echo "  issueSource        = $ISSUE_SOURCE  ($issue_source_source)"
  if [[ "$ISSUE_SOURCE" != "none" ]]; then
    echo "  issueLabel         = $ISSUE_LABEL  ($issue_label_source)"
    echo "  issueInProgressLabel = $ISSUE_IN_PROGRESS_LABEL  ($issue_ip_label_source)"
    echo "  issueRepo          = ${ISSUE_REPO:-<auto-detect>}  ($issue_repo_source)"
    echo "  issueCloseOnComplete = $ISSUE_CLOSE_ON_COMPLETE  ($issue_close_source)"
    echo "  issueCommentProgress = $ISSUE_COMMENT_PROGRESS  ($issue_comment_source)"
  fi
  echo ""
  # Show detected agent type using detect_agent_type from validate.sh
  if [[ -n "$AGENT_COMMAND" ]]; then
    detect_agent_type
    echo "  detectedAgentType  = $DETECTED_AGENT_TYPE"
  else
    echo "  detectedAgentType  = <no agentCommand set>"
  fi
  echo ""
  if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
    echo "  worktree           = true"
    echo "  mainWorktree       = $RALPHAI_MAIN_WORKTREE"
    echo ""
  fi

  if [[ -f "$CONFIG_FILE" ]]; then
    echo "Config file: $CONFIG_FILE (loaded)"
  else
    echo "Config file: $CONFIG_FILE (not found, using defaults)"
  fi
  exit 0
fi

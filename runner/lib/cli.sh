# cli.sh — CLI argument parsing, config precedence orchestration,
# and fallback chain setup.
# Sourced by ralphai.sh after config.sh. Runs at source-time.
# Depends on: defaults.sh (DEFAULT_* vars), validate.sh (validate_* helpers),
#             config.sh (load_config, apply_config, apply_env_overrides)

print_usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "  Recommended daily invocation from an initialized repo: ralphai run ..."
  echo ""
  echo "  Auto-detects work: resumes in-progress plans, or picks from backlog."
  echo "  Turn budget resets for each new plan (normal mode)."
  echo "  Pass 0 for unlimited turns (runs until complete or stuck)."
  echo "  Default: 5 turns per plan."
  echo ""
  echo "Options:"
  echo "  --turns=<n>                     Turns per plan (default: 5, 0 = unlimited)"
  echo "  --dry-run, -n                    Preview what Ralphai would do without mutating state"
  echo "  --resume, -r                     Auto-commit dirty state and continue"
  echo "  --agent-command=<command>        Override agent CLI command (e.g. 'claude -p')"
  echo "  --feedback-commands=<list>       Comma-separated feedback commands (e.g. 'npm test,npm run build')"
  echo "  --base-branch=<branch>           Override base branch (default: $DEFAULT_BASE_BRANCH)"
  echo "  --branch                         Branch mode (default): create isolated branch, commit, no PR"
  echo "  --pr                             PR mode: create branch, push, and open PR"
  echo "  --patch                          Patch mode: leave changes uncommitted in working tree"
  echo "  --continuous                     Keep processing backlog plans after the first completes"
  echo "  --max-stuck=<n>                  Override stuck threshold (default: $DEFAULT_MAX_STUCK)"
  echo "  --turn-timeout=<seconds>         Timeout per agent invocation (default: 0 = no timeout)"
  echo "  --fallback-agents=<list>         Comma-separated fallback agent commands (tried when stuck)"
  echo "  --auto-commit                    Enable auto-commit of agent changes (per-turn and resume recovery)"
  echo "  --no-auto-commit                 Disable auto-commit (default; only meaningful in patch mode)"
  echo "  --prompt-mode=<mode>             Prompt file ref format: 'auto', 'at-path', or 'inline' (default: auto)"
  echo "  --issue-source=<source>          Issue source: 'none' or 'github' (default: none)"
  echo "  --issue-label=<label>            Label to filter issues by (default: ralphai)"
  echo "  --issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)"
  echo "  --issue-repo=<owner/repo>        Override repo for issue operations (default: auto-detect)"
  echo "  --issue-close-on-complete=<bool> Close issue on completion (default: true)"
  echo "  --issue-comment-progress=<bool>  Comment on issue during run (default: true)"
  echo "  --show-config                    Print resolved settings and exit"
  echo "  --help, -h                       Show this help message"
  echo ""
  echo "Config file: $CONFIG_FILE (optional, JSON format)"
  echo "  Supported keys: agentCommand, feedbackCommands, baseBranch, maxStuck,"
  echo "                  mode, continuous, autoCommit, turns, turnTimeout, promptMode,"
  echo "                  fallbackAgents, issueSource, issueLabel,"
  echo "                  issueInProgressLabel, issueRepo,"
  echo "                  issueCloseOnComplete, issueCommentProgress"
  echo ""
  echo "Env var overrides: RALPHAI_AGENT_COMMAND, RALPHAI_FEEDBACK_COMMANDS,"
  echo "                   RALPHAI_BASE_BRANCH, RALPHAI_MAX_STUCK,"
  echo "                   RALPHAI_MODE, RALPHAI_CONTINUOUS,"
  echo "                   RALPHAI_AUTO_COMMIT, RALPHAI_TURNS,"
  echo "                   RALPHAI_TURN_TIMEOUT, RALPHAI_FALLBACK_AGENTS,"
  echo "                   RALPHAI_PROMPT_MODE,"
  echo "                   RALPHAI_ISSUE_SOURCE,"
  echo "                   RALPHAI_ISSUE_LABEL, RALPHAI_ISSUE_IN_PROGRESS_LABEL,"
  echo "                   RALPHAI_ISSUE_REPO, RALPHAI_ISSUE_CLOSE_ON_COMPLETE,"
  echo "                   RALPHAI_ISSUE_COMMENT_PROGRESS"
  echo ""
  echo "Precedence: CLI flags > env vars > config file > built-in defaults"
  echo ""
  echo "Examples:"
  echo "  $0 --turns=10                                # 10 turns per plan (default: 5)"
  echo "  $0 --turns=0                                 # unlimited turns per plan"
  echo "  $0 --dry-run                                 # preview only"
  echo "  $0 --turns=10 --dry-run                      # preview with explicit turns"
  echo "  $0 --turns=10 --resume                       # recover dirty state and continue"
  echo "  $0 --turns=10 --agent-command='claude -p'     # use Claude Code"
  echo "  $0 --turns=10 --agent-command='opencode run --agent build'  # use OpenCode"
  echo "  $0 --turns=10 --branch                       # create isolated branch, commit (no PR)"
  echo "  $0 --turns=10 --branch --continuous          # keep draining backlog on isolated branches"
  echo "  RALPHAI_AGENT_COMMAND='codex exec' $0 --turns=10  # override via env var"
  echo ""
  echo "Feature branch workflow:"
  echo "  $0 --turns=10 --patch --base-branch=feature/big-thing  # leave changes uncommitted on a feature branch"
}

# --- Parse args ---
for arg in "$@"; do
  case "$arg" in
    --turns=*)
      CLI_TURNS="${arg#--turns=}"
      validate_nonneg_int "$CLI_TURNS" "--turns"
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    --dry-run|-n)
      DRY_RUN=true
      ;;
    --resume|-r)
      RESUME=true
      ;;
    --show-config)
      SHOW_CONFIG=true
      ;;
    --agent-command=*)
      CLI_AGENT_COMMAND="${arg#--agent-command=}"
      if [[ -z "$CLI_AGENT_COMMAND" ]]; then
        echo "ERROR: --agent-command requires a non-empty value (e.g. --agent-command='claude -p')"
        exit 1
      fi
      ;;
    --feedback-commands=*)
      CLI_FEEDBACK_COMMANDS="${arg#--feedback-commands=}"
      # Empty value is valid (disables feedback commands); validate entries if non-empty
      if [[ -n "$CLI_FEEDBACK_COMMANDS" ]]; then
        validate_comma_list "$CLI_FEEDBACK_COMMANDS" "--feedback-commands"
      fi
      ;;
    --base-branch=*)
      CLI_BASE_BRANCH="${arg#--base-branch=}"
      if [[ -z "$CLI_BASE_BRANCH" ]]; then
        echo "ERROR: --base-branch requires a non-empty value (e.g. --base-branch=main)"
        exit 1
      fi
      if [[ "$CLI_BASE_BRANCH" =~ [[:space:]] ]]; then
        echo "ERROR: --base-branch must be a single token without spaces, got '$CLI_BASE_BRANCH'"
        exit 1
      fi
      ;;
    --max-stuck=*)
      CLI_MAX_STUCK="${arg#--max-stuck=}"
      validate_positive_int "$CLI_MAX_STUCK" "--max-stuck"
      ;;
    --turn-timeout=*)
      CLI_TURN_TIMEOUT="${arg#--turn-timeout=}"
      validate_nonneg_int "$CLI_TURN_TIMEOUT" "--turn-timeout" "seconds"
      ;;
    --branch)
      CLI_MODE="branch"
      ;;
    --pr)
      CLI_MODE="pr"
      ;;
    --patch)
      CLI_MODE="patch"
      ;;
    --continuous)
      CLI_CONTINUOUS="true"
      ;;
    --auto-commit)
      CLI_AUTO_COMMIT="true"
      ;;
    --no-auto-commit)
      CLI_AUTO_COMMIT="false"
      ;;
    --prompt-mode=*)
      CLI_PROMPT_MODE="${arg#--prompt-mode=}"
      validate_enum "$CLI_PROMPT_MODE" "--prompt-mode" "auto" "at-path" "inline"
      ;;
    --issue-source=*)
      CLI_ISSUE_SOURCE="${arg#--issue-source=}"
      validate_enum "$CLI_ISSUE_SOURCE" "--issue-source" "none" "github"
      ;;
    --issue-label=*)
      CLI_ISSUE_LABEL="${arg#--issue-label=}"
      if [[ -z "$CLI_ISSUE_LABEL" ]]; then
        echo "ERROR: --issue-label requires a non-empty value"
        exit 1
      fi
      ;;
    --issue-in-progress-label=*)
      CLI_ISSUE_IN_PROGRESS_LABEL="${arg#--issue-in-progress-label=}"
      if [[ -z "$CLI_ISSUE_IN_PROGRESS_LABEL" ]]; then
        echo "ERROR: --issue-in-progress-label requires a non-empty value"
        exit 1
      fi
      ;;
    --issue-repo=*)
      CLI_ISSUE_REPO="${arg#--issue-repo=}"
      ;;
    --issue-close-on-complete=*)
      CLI_ISSUE_CLOSE_ON_COMPLETE="${arg#--issue-close-on-complete=}"
      validate_boolean "$CLI_ISSUE_CLOSE_ON_COMPLETE" "--issue-close-on-complete"
      ;;
    --issue-comment-progress=*)
      CLI_ISSUE_COMMENT_PROGRESS="${arg#--issue-comment-progress=}"
      validate_boolean "$CLI_ISSUE_COMMENT_PROGRESS" "--issue-comment-progress"
      ;;
    --fallback-agents=*)
      CLI_FALLBACK_AGENTS="${arg#--fallback-agents=}"
      # Empty value is valid (disables fallback); validate entries if non-empty
      if [[ -n "$CLI_FALLBACK_AGENTS" ]]; then
        validate_comma_list "$CLI_FALLBACK_AGENTS" "--fallback-agents"
      fi
      ;;
    *)
      echo "ERROR: Unrecognized argument: $arg"
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "$TURNS" ]]; then
  TURNS="5"
fi

if ! [[ "$TURNS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: turns must be a non-negative integer, got '$TURNS'"
  exit 1
fi

# --- Load config and apply precedence ---
# Precedence: CLI flags > env vars > config file > built-in defaults
load_config "$CONFIG_FILE"
apply_config
apply_env_overrides

# Apply CLI overrides last (highest priority)
if [[ -n "$CLI_AGENT_COMMAND" ]]; then
  AGENT_COMMAND="$CLI_AGENT_COMMAND"
fi
if [[ -n "$CLI_FEEDBACK_COMMANDS" ]]; then
  FEEDBACK_COMMANDS="$CLI_FEEDBACK_COMMANDS"
fi
if [[ -n "$CLI_BASE_BRANCH" ]]; then
  BASE_BRANCH="$CLI_BASE_BRANCH"
fi
if [[ -n "$CLI_MAX_STUCK" ]]; then
  MAX_STUCK="$CLI_MAX_STUCK"
fi
if [[ -n "$CLI_TURNS" ]]; then
  TURNS="$CLI_TURNS"
fi
if [[ -n "$CLI_MODE" ]]; then
  MODE="$CLI_MODE"
fi
if [[ -n "$CLI_CONTINUOUS" ]]; then
  CONTINUOUS="$CLI_CONTINUOUS"
fi
if [[ -n "$CLI_TURN_TIMEOUT" ]]; then
  TURN_TIMEOUT="$CLI_TURN_TIMEOUT"
fi
if [[ -n "$CLI_ISSUE_SOURCE" ]]; then
  ISSUE_SOURCE="$CLI_ISSUE_SOURCE"
fi
if [[ -n "$CLI_ISSUE_LABEL" ]]; then
  ISSUE_LABEL="$CLI_ISSUE_LABEL"
fi
if [[ -n "$CLI_ISSUE_IN_PROGRESS_LABEL" ]]; then
  ISSUE_IN_PROGRESS_LABEL="$CLI_ISSUE_IN_PROGRESS_LABEL"
fi
if [[ -n "$CLI_ISSUE_REPO" ]]; then
  ISSUE_REPO="$CLI_ISSUE_REPO"
fi
if [[ -n "$CLI_ISSUE_CLOSE_ON_COMPLETE" ]]; then
  ISSUE_CLOSE_ON_COMPLETE="$CLI_ISSUE_CLOSE_ON_COMPLETE"
fi
if [[ -n "$CLI_ISSUE_COMMENT_PROGRESS" ]]; then
  ISSUE_COMMENT_PROGRESS="$CLI_ISSUE_COMMENT_PROGRESS"
fi
if [[ -n "$CLI_PROMPT_MODE" ]]; then
  PROMPT_MODE="$CLI_PROMPT_MODE"
fi
if [[ -n "$CLI_FALLBACK_AGENTS" ]]; then
  FALLBACK_AGENTS="$CLI_FALLBACK_AGENTS"
fi
if [[ -n "$CLI_AUTO_COMMIT" ]]; then
  AUTO_COMMIT="$CLI_AUTO_COMMIT"
fi

# --- Parse fallback chain into array ---
FALLBACK_CHAIN=()
if [[ -n "$FALLBACK_AGENTS" ]]; then
  IFS=',' read -ra FALLBACK_CHAIN <<< "$FALLBACK_AGENTS"
  # Trim whitespace from each entry
  for i in "${!FALLBACK_CHAIN[@]}"; do
    FALLBACK_CHAIN[$i]=$(echo "${FALLBACK_CHAIN[$i]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  done
fi
FALLBACK_INDEX=0

# --- Show resolved config and exit ---
if [[ "$SHOW_CONFIG" == true ]]; then
  echo "Resolved settings (precedence: CLI > env > config > defaults):"
  echo ""

  # Determine source for each setting
  if [[ -n "$CLI_AGENT_COMMAND" ]]; then
    agent_command_source="cli (--agent-command=$CLI_AGENT_COMMAND)"
  elif [[ -n "${RALPHAI_AGENT_COMMAND:-}" ]]; then
    agent_command_source="env (RALPHAI_AGENT_COMMAND=$RALPHAI_AGENT_COMMAND)"
  elif [[ -n "${CONFIG_AGENT_COMMAND:-}" ]]; then
    agent_command_source="config ($CONFIG_FILE)"
  else
    agent_command_source="default (none)"
  fi

  if [[ -n "$CLI_FEEDBACK_COMMANDS" ]]; then
    feedback_commands_source="cli (--feedback-commands=$CLI_FEEDBACK_COMMANDS)"
  elif [[ -n "${RALPHAI_FEEDBACK_COMMANDS:-}" ]]; then
    feedback_commands_source="env (RALPHAI_FEEDBACK_COMMANDS=$RALPHAI_FEEDBACK_COMMANDS)"
  elif [[ -n "${CONFIG_FEEDBACK_COMMANDS:-}" ]]; then
    feedback_commands_source="config ($CONFIG_FILE)"
  else
    feedback_commands_source="default (none)"
  fi

  if [[ -n "$CLI_BASE_BRANCH" ]]; then
    branch_source="cli (--base-branch=$CLI_BASE_BRANCH)"
  elif [[ -n "${RALPHAI_BASE_BRANCH:-}" ]]; then
    branch_source="env (RALPHAI_BASE_BRANCH=$RALPHAI_BASE_BRANCH)"
  elif [[ -n "${CONFIG_BASE_BRANCH:-}" ]]; then
    branch_source="config ($CONFIG_FILE)"
  else
    branch_source="default"
  fi

  if [[ -n "$CLI_MAX_STUCK" ]]; then
    stuck_source="cli (--max-stuck=$CLI_MAX_STUCK)"
  elif [[ -n "${RALPHAI_MAX_STUCK:-}" ]]; then
    stuck_source="env (RALPHAI_MAX_STUCK=$RALPHAI_MAX_STUCK)"
  elif [[ -n "${CONFIG_MAX_STUCK:-}" ]]; then
    stuck_source="config ($CONFIG_FILE)"
  else
    stuck_source="default"
  fi

  if [[ -n "$CLI_MODE" ]]; then
    mode_source="cli (--${MODE})"
  elif [[ -n "${RALPHAI_MODE:-}" ]]; then
    mode_source="env (RALPHAI_MODE=$RALPHAI_MODE)"
  elif [[ -n "${CONFIG_MODE:-}" ]]; then
    mode_source="config ($CONFIG_FILE)"
  else
    mode_source="default"
  fi

  if [[ -n "$CLI_CONTINUOUS" ]]; then
    continuous_source="cli (--continuous)"
  elif [[ -n "${RALPHAI_CONTINUOUS:-}" ]]; then
    continuous_source="env (RALPHAI_CONTINUOUS=$RALPHAI_CONTINUOUS)"
  elif [[ -n "${CONFIG_CONTINUOUS:-}" ]]; then
    continuous_source="config ($CONFIG_FILE)"
  else
    continuous_source="default"
  fi

  if [[ -n "$CLI_TURN_TIMEOUT" ]]; then
    timeout_source="cli (--turn-timeout=$CLI_TURN_TIMEOUT)"
  elif [[ -n "${RALPHAI_TURN_TIMEOUT:-}" ]]; then
    timeout_source="env (RALPHAI_TURN_TIMEOUT=$RALPHAI_TURN_TIMEOUT)"
  elif [[ -n "${CONFIG_TURN_TIMEOUT:-}" ]]; then
    timeout_source="config ($CONFIG_FILE)"
  else
    timeout_source="default"
  fi

  if [[ -n "$CLI_ISSUE_SOURCE" ]]; then
    issue_source_source="cli (--issue-source=$CLI_ISSUE_SOURCE)"
  elif [[ -n "${RALPHAI_ISSUE_SOURCE:-}" ]]; then
    issue_source_source="env (RALPHAI_ISSUE_SOURCE=$RALPHAI_ISSUE_SOURCE)"
  elif [[ -n "${CONFIG_ISSUE_SOURCE:-}" ]]; then
    issue_source_source="config ($CONFIG_FILE)"
  else
    issue_source_source="default"
  fi

  if [[ -n "$CLI_ISSUE_LABEL" ]]; then
    issue_label_source="cli (--issue-label=$CLI_ISSUE_LABEL)"
  elif [[ -n "${RALPHAI_ISSUE_LABEL:-}" ]]; then
    issue_label_source="env (RALPHAI_ISSUE_LABEL=$RALPHAI_ISSUE_LABEL)"
  elif [[ -n "${CONFIG_ISSUE_LABEL:-}" ]]; then
    issue_label_source="config ($CONFIG_FILE)"
  else
    issue_label_source="default"
  fi

  if [[ -n "$CLI_ISSUE_IN_PROGRESS_LABEL" ]]; then
    issue_ip_label_source="cli (--issue-in-progress-label=$CLI_ISSUE_IN_PROGRESS_LABEL)"
  elif [[ -n "${RALPHAI_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    issue_ip_label_source="env (RALPHAI_ISSUE_IN_PROGRESS_LABEL=$RALPHAI_ISSUE_IN_PROGRESS_LABEL)"
  elif [[ -n "${CONFIG_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    issue_ip_label_source="config ($CONFIG_FILE)"
  else
    issue_ip_label_source="default"
  fi

  if [[ -n "$CLI_ISSUE_REPO" ]]; then
    issue_repo_source="cli (--issue-repo=$CLI_ISSUE_REPO)"
  elif [[ -n "${RALPHAI_ISSUE_REPO:-}" ]]; then
    issue_repo_source="env (RALPHAI_ISSUE_REPO=$RALPHAI_ISSUE_REPO)"
  elif [[ -n "${CONFIG_ISSUE_REPO:-}" ]]; then
    issue_repo_source="config ($CONFIG_FILE)"
  else
    issue_repo_source="default (auto-detect)"
  fi

  if [[ -n "$CLI_ISSUE_CLOSE_ON_COMPLETE" ]]; then
    issue_close_source="cli (--issue-close-on-complete=$CLI_ISSUE_CLOSE_ON_COMPLETE)"
  elif [[ -n "${RALPHAI_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    issue_close_source="env (RALPHAI_ISSUE_CLOSE_ON_COMPLETE=$RALPHAI_ISSUE_CLOSE_ON_COMPLETE)"
  elif [[ -n "${CONFIG_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    issue_close_source="config ($CONFIG_FILE)"
  else
    issue_close_source="default"
  fi

  if [[ -n "$CLI_ISSUE_COMMENT_PROGRESS" ]]; then
    issue_comment_source="cli (--issue-comment-progress=$CLI_ISSUE_COMMENT_PROGRESS)"
  elif [[ -n "${RALPHAI_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    issue_comment_source="env (RALPHAI_ISSUE_COMMENT_PROGRESS=$RALPHAI_ISSUE_COMMENT_PROGRESS)"
  elif [[ -n "${CONFIG_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    issue_comment_source="config ($CONFIG_FILE)"
  else
    issue_comment_source="default"
  fi

  if [[ -n "$CLI_PROMPT_MODE" ]]; then
    prompt_mode_source="cli (--prompt-mode=$CLI_PROMPT_MODE)"
  elif [[ -n "${RALPHAI_PROMPT_MODE:-}" ]]; then
    prompt_mode_source="env (RALPHAI_PROMPT_MODE=$RALPHAI_PROMPT_MODE)"
  elif [[ -n "${CONFIG_PROMPT_MODE:-}" ]]; then
    prompt_mode_source="config ($CONFIG_FILE)"
  else
    prompt_mode_source="default"
  fi

  if [[ -n "$CLI_FALLBACK_AGENTS" ]]; then
    fallback_agents_source="cli (--fallback-agents=$CLI_FALLBACK_AGENTS)"
  elif [[ -n "${RALPHAI_FALLBACK_AGENTS:-}" ]]; then
    fallback_agents_source="env (RALPHAI_FALLBACK_AGENTS=$RALPHAI_FALLBACK_AGENTS)"
  elif [[ -n "${CONFIG_FALLBACK_AGENTS:-}" ]]; then
    fallback_agents_source="config ($CONFIG_FILE)"
  else
    fallback_agents_source="default (none)"
  fi

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

  if [[ -n "$CLI_TURNS" ]]; then
    turns_source="cli (--turns=$CLI_TURNS)"
  elif [[ -n "${RALPHAI_TURNS:-}" ]]; then
    turns_source="env (RALPHAI_TURNS=$RALPHAI_TURNS)"
  elif [[ -n "${CONFIG_TURNS:-}" ]]; then
    turns_source="config ($CONFIG_FILE)"
  else
    turns_source="default"
  fi

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
  # Show detected agent type (informational)
  if [[ -n "$AGENT_COMMAND" ]]; then
    # Inline detection for --show-config (detect_agent_type is defined later in the script)
    _sc_cmd=$(echo "$AGENT_COMMAND" | tr '[:upper:]' '[:lower:]')
    _sc_agent_type="unknown"
    case "$_sc_cmd" in
      *claude*)   _sc_agent_type="claude" ;;
      *opencode*) _sc_agent_type="opencode" ;;
      *codex*)    _sc_agent_type="codex" ;;
      *gemini*)   _sc_agent_type="gemini" ;;
      *aider*)    _sc_agent_type="aider" ;;
      *goose*)    _sc_agent_type="goose" ;;
      *kiro*)     _sc_agent_type="kiro" ;;
      *amp*)      _sc_agent_type="amp" ;;
    esac
    echo "  detectedAgentType  = $_sc_agent_type"
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

# --- Validate agentCommand is set ---
if [[ -z "$AGENT_COMMAND" ]]; then
  echo "ERROR: agentCommand is required. Set it in ralphai.json, RALPHAI_AGENT_COMMAND env var, or --agent-command= flag."
  echo "Examples: \"agentCommand\": \"opencode run --agent build\""
  echo "          \"agentCommand\": \"claude -p\""
  echo "          \"agentCommand\": \"codex exec\""
  exit 1
fi

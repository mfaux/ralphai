# config.sh — Configuration loading, CLI parsing, and --show-config.
# Sourced by ralph.sh. Contains load_config(), apply_config(),
# apply_env_overrides(), print_usage(), CLI arg parsing, --show-config block,
# and agentCommand validation.

# --- Config file loader ---
# Parses .ralph/ralph.config (key=value, comments, blank lines).
# Sets CONFIG_AGENT_COMMAND, CONFIG_FEEDBACK_COMMANDS, CONFIG_BASE_BRANCH,
# CONFIG_MAX_STUCK, CONFIG_MODE, CONFIG_PROMPT_MODE when present.
# Fails fast on unknown keys or invalid values.
load_config() {
  local config_path="$1"

  # Missing config file is a no-op
  if [[ ! -f "$config_path" ]]; then
    return 0
  fi

  local line_num=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_num=$((line_num + 1))

    # Skip blank lines and comments
    if [[ -z "$line" || "$line" =~ ^[[:space:]]*# || "$line" =~ ^[[:space:]]*$ ]]; then
      continue
    fi

    # Strip leading/trailing whitespace
    local trimmed
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    # Must be key=value
    if [[ ! "$trimmed" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]]; then
      echo "ERROR: $config_path:$line_num: malformed line: $trimmed"
      echo "Expected key=value format (e.g. agentCommand=claude -p)"
      exit 1
    fi

    local key="${trimmed%%=*}"
    local value="${trimmed#*=}"

    case "$key" in
      agentCommand)
        if [[ -z "$value" ]]; then
          echo "ERROR: $config_path:$line_num: 'agentCommand' must be a non-empty command"
          exit 1
        fi
        CONFIG_AGENT_COMMAND="$value"
        ;;
      feedbackCommands)
        # Comma-separated list of shell commands; empty is valid (disables feedback commands)
        if [[ -n "$value" ]]; then
          # Validate: no empty entries between commas
          IFS=',' read -ra fc_parts <<< "$value"
          for fc in "${fc_parts[@]}"; do
            local trimmed_fc
            trimmed_fc=$(echo "$fc" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            if [[ -z "$trimmed_fc" ]]; then
              echo "ERROR: $config_path:$line_num: 'feedbackCommands' contains an empty entry in '$value'"
              exit 1
            fi
          done
        fi
        CONFIG_FEEDBACK_COMMANDS="$value"
        ;;
      baseBranch)
        if [[ -z "$value" ]]; then
          echo "ERROR: $config_path:$line_num: 'baseBranch' must be a non-empty branch name"
          exit 1
        fi
        if [[ "$value" =~ [[:space:]] ]]; then
          echo "ERROR: $config_path:$line_num: 'baseBranch' must be a single token without spaces, got '$value'"
          exit 1
        fi
        CONFIG_BASE_BRANCH="$value"
        ;;
      maxStuck)
        if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
          echo "ERROR: $config_path:$line_num: 'maxStuck' must be a positive integer, got '$value'"
          exit 1
        fi
        CONFIG_MAX_STUCK="$value"
        ;;
      mode)
        if [[ "$value" != "pr" && "$value" != "direct" ]]; then
          echo "ERROR: $config_path:$line_num: 'mode' must be 'pr' or 'direct', got '$value'"
          exit 1
        fi
        CONFIG_MODE="$value"
        ;;
      issueCloseOnComplete)
        if [[ "$value" != "true" && "$value" != "false" ]]; then
          echo "ERROR: $config_path:$line_num: 'issueCloseOnComplete' must be 'true' or 'false', got '$value'"
          exit 1
        fi
        CONFIG_ISSUE_CLOSE_ON_COMPLETE="$value"
        ;;
      issueSource)
        if [[ "$value" != "none" && "$value" != "github" ]]; then
          echo "ERROR: $config_path:$line_num: 'issueSource' must be 'none' or 'github', got '$value'"
          exit 1
        fi
        CONFIG_ISSUE_SOURCE="$value"
        ;;
      issueLabel)
        if [[ -z "$value" ]]; then
          echo "ERROR: $config_path:$line_num: 'issueLabel' must be a non-empty label name"
          exit 1
        fi
        CONFIG_ISSUE_LABEL="$value"
        ;;
      issueInProgressLabel)
        if [[ -z "$value" ]]; then
          echo "ERROR: $config_path:$line_num: 'issueInProgressLabel' must be a non-empty label name"
          exit 1
        fi
        CONFIG_ISSUE_IN_PROGRESS_LABEL="$value"
        ;;
      issueRepo)
        CONFIG_ISSUE_REPO="$value"
        ;;
      issueCommentProgress)
        if [[ "$value" != "true" && "$value" != "false" ]]; then
          echo "ERROR: $config_path:$line_num: 'issueCommentProgress' must be 'true' or 'false', got '$value'"
          exit 1
        fi
        CONFIG_ISSUE_COMMENT_PROGRESS="$value"
        ;;
      iterationTimeout)
        if [[ ! "$value" =~ ^[0-9]+$ ]]; then
          echo "ERROR: $config_path:$line_num: 'iterationTimeout' must be a non-negative integer (seconds), got '$value'"
          exit 1
        fi
        CONFIG_ITERATION_TIMEOUT="$value"
        ;;
      promptMode)
        if [[ "$value" != "auto" && "$value" != "at-path" && "$value" != "inline" ]]; then
          echo "ERROR: $config_path:$line_num: 'promptMode' must be 'auto', 'at-path', or 'inline', got '$value'"
          exit 1
        fi
        CONFIG_PROMPT_MODE="$value"
        ;;
      *)
        echo "WARNING: $config_path:$line_num: ignoring unknown config key '$key'"
        ;;
    esac
  done < "$config_path"
}

# --- Apply config file settings ---
# Called after load_config to merge config values into resolved settings.
apply_config() {
  if [[ -n "${CONFIG_AGENT_COMMAND:-}" ]]; then
    AGENT_COMMAND="$CONFIG_AGENT_COMMAND"
  fi
  if [[ -n "${CONFIG_FEEDBACK_COMMANDS:-}" ]]; then
    FEEDBACK_COMMANDS="$CONFIG_FEEDBACK_COMMANDS"
  fi
  if [[ -n "${CONFIG_BASE_BRANCH:-}" ]]; then
    BASE_BRANCH="$CONFIG_BASE_BRANCH"
  fi
  if [[ -n "${CONFIG_MAX_STUCK:-}" ]]; then
    MAX_STUCK="$CONFIG_MAX_STUCK"
  fi
  if [[ -n "${CONFIG_MODE:-}" ]]; then
    MODE="$CONFIG_MODE"
  fi
  if [[ -n "${CONFIG_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    ISSUE_CLOSE_ON_COMPLETE="$CONFIG_ISSUE_CLOSE_ON_COMPLETE"
  fi
  if [[ -n "${CONFIG_ISSUE_SOURCE:-}" ]]; then
    ISSUE_SOURCE="$CONFIG_ISSUE_SOURCE"
  fi
  if [[ -n "${CONFIG_ISSUE_LABEL:-}" ]]; then
    ISSUE_LABEL="$CONFIG_ISSUE_LABEL"
  fi
  if [[ -n "${CONFIG_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    ISSUE_IN_PROGRESS_LABEL="$CONFIG_ISSUE_IN_PROGRESS_LABEL"
  fi
  if [[ -n "${CONFIG_ISSUE_REPO:-}" ]]; then
    ISSUE_REPO="$CONFIG_ISSUE_REPO"
  fi
  if [[ -n "${CONFIG_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    ISSUE_COMMENT_PROGRESS="$CONFIG_ISSUE_COMMENT_PROGRESS"
  fi
  if [[ -n "${CONFIG_ITERATION_TIMEOUT:-}" ]]; then
    ITERATION_TIMEOUT="$CONFIG_ITERATION_TIMEOUT"
  fi
  if [[ -n "${CONFIG_PROMPT_MODE:-}" ]]; then
    PROMPT_MODE="$CONFIG_PROMPT_MODE"
  fi
}

# --- Apply env var overrides ---
# Env vars override config file values but are overridden by CLI flags.
apply_env_overrides() {
  if [[ -n "${RALPH_AGENT_COMMAND:-}" ]]; then
    AGENT_COMMAND="$RALPH_AGENT_COMMAND"
  fi
  if [[ -n "${RALPH_FEEDBACK_COMMANDS:-}" ]]; then
    FEEDBACK_COMMANDS="$RALPH_FEEDBACK_COMMANDS"
  fi
  if [[ -n "${RALPH_BASE_BRANCH:-}" ]]; then
    if [[ "$RALPH_BASE_BRANCH" =~ [[:space:]] ]]; then
      echo "ERROR: RALPH_BASE_BRANCH must be a single token without spaces, got '$RALPH_BASE_BRANCH'"
      exit 1
    fi
    BASE_BRANCH="$RALPH_BASE_BRANCH"
  fi
  if [[ -n "${RALPH_MAX_STUCK:-}" ]]; then
    if [[ ! "$RALPH_MAX_STUCK" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERROR: RALPH_MAX_STUCK must be a positive integer, got '$RALPH_MAX_STUCK'"
      exit 1
    fi
    MAX_STUCK="$RALPH_MAX_STUCK"
  fi
  if [[ -n "${RALPH_MODE:-}" ]]; then
    if [[ "$RALPH_MODE" != "pr" && "$RALPH_MODE" != "direct" ]]; then
      echo "ERROR: RALPH_MODE must be 'pr' or 'direct', got '$RALPH_MODE'"
      exit 1
    fi
    MODE="$RALPH_MODE"
  fi
  if [[ -n "${RALPH_ITERATION_TIMEOUT:-}" ]]; then
    if [[ ! "$RALPH_ITERATION_TIMEOUT" =~ ^[0-9]+$ ]]; then
      echo "ERROR: RALPH_ITERATION_TIMEOUT must be a non-negative integer (seconds), got '$RALPH_ITERATION_TIMEOUT'"
      exit 1
    fi
    ITERATION_TIMEOUT="$RALPH_ITERATION_TIMEOUT"
  fi
  if [[ -n "${RALPH_ISSUE_SOURCE:-}" ]]; then
    if [[ "$RALPH_ISSUE_SOURCE" != "none" && "$RALPH_ISSUE_SOURCE" != "github" ]]; then
      echo "ERROR: RALPH_ISSUE_SOURCE must be 'none' or 'github', got '$RALPH_ISSUE_SOURCE'"
      exit 1
    fi
    ISSUE_SOURCE="$RALPH_ISSUE_SOURCE"
  fi
  if [[ -n "${RALPH_ISSUE_LABEL:-}" ]]; then
    ISSUE_LABEL="$RALPH_ISSUE_LABEL"
  fi
  if [[ -n "${RALPH_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    ISSUE_IN_PROGRESS_LABEL="$RALPH_ISSUE_IN_PROGRESS_LABEL"
  fi
  if [[ -n "${RALPH_ISSUE_REPO:-}" ]]; then
    ISSUE_REPO="$RALPH_ISSUE_REPO"
  fi
  if [[ -n "${RALPH_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    if [[ "$RALPH_ISSUE_CLOSE_ON_COMPLETE" != "true" && "$RALPH_ISSUE_CLOSE_ON_COMPLETE" != "false" ]]; then
      echo "ERROR: RALPH_ISSUE_CLOSE_ON_COMPLETE must be 'true' or 'false', got '$RALPH_ISSUE_CLOSE_ON_COMPLETE'"
      exit 1
    fi
    ISSUE_CLOSE_ON_COMPLETE="$RALPH_ISSUE_CLOSE_ON_COMPLETE"
  fi
  if [[ -n "${RALPH_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    if [[ "$RALPH_ISSUE_COMMENT_PROGRESS" != "true" && "$RALPH_ISSUE_COMMENT_PROGRESS" != "false" ]]; then
      echo "ERROR: RALPH_ISSUE_COMMENT_PROGRESS must be 'true' or 'false', got '$RALPH_ISSUE_COMMENT_PROGRESS'"
      exit 1
    fi
    ISSUE_COMMENT_PROGRESS="$RALPH_ISSUE_COMMENT_PROGRESS"
  fi
  if [[ -n "${RALPH_PROMPT_MODE:-}" ]]; then
    if [[ "$RALPH_PROMPT_MODE" != "auto" && "$RALPH_PROMPT_MODE" != "at-path" && "$RALPH_PROMPT_MODE" != "inline" ]]; then
      echo "ERROR: RALPH_PROMPT_MODE must be 'auto', 'at-path', or 'inline', got '$RALPH_PROMPT_MODE'"
      exit 1
    fi
    PROMPT_MODE="$RALPH_PROMPT_MODE"
  fi
}

print_usage() {
  echo "Usage: $0 [iterations-per-plan] [options]"
  echo ""
  echo "  Recommended daily invocation from an initialized repo: ./.ralph/ralph.sh ..."
  echo ""
  echo "  Auto-detects work: resumes in-progress plans, or picks from backlog."
  echo "  Iteration budget resets for each new plan (normal mode)."
  echo "  Pass 0 for unlimited iterations (runs until complete or stuck)."
  echo "  Default: 5 iterations per plan."
  echo ""
  echo "Options:"
  echo "  --dry-run, -n                    Preview what Ralph would do without mutating state"
  echo "  --resume, -r                     Auto-commit dirty state and continue"
  echo "  --agent-command=<command>        Override agent CLI command (e.g. 'claude -p')"
  echo "  --feedback-commands=<list>       Comma-separated feedback commands (e.g. 'npm test,npm run build')"
  echo "  --base-branch=<branch>           Override base branch (default: $DEFAULT_BASE_BRANCH)"
  echo "  --direct                         Direct mode: commit on current branch, no PR"
  echo "  --pr                             PR mode (default): create branch and open PR"
  echo "  --max-stuck=<n>                  Override stuck threshold (default: $DEFAULT_MAX_STUCK)"
  echo "  --iteration-timeout=<seconds>    Timeout per agent invocation (default: 0 = no timeout)"
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
  echo "Config file: $CONFIG_FILE (optional, key=value format)"
  echo "  Supported keys: agentCommand, feedbackCommands, baseBranch, maxStuck,"
  echo "                  mode, iterationTimeout, promptMode,"
  echo "                  issueSource, issueLabel, issueInProgressLabel, issueRepo,"
  echo "                  issueCloseOnComplete, issueCommentProgress"
  echo ""
  echo "Env var overrides: RALPH_AGENT_COMMAND, RALPH_FEEDBACK_COMMANDS,"
  echo "                   RALPH_BASE_BRANCH, RALPH_MAX_STUCK,"
  echo "                   RALPH_MODE, RALPH_ITERATION_TIMEOUT,"
  echo "                   RALPH_PROMPT_MODE,"
  echo "                   RALPH_ISSUE_SOURCE,"
  echo "                   RALPH_ISSUE_LABEL, RALPH_ISSUE_IN_PROGRESS_LABEL,"
  echo "                   RALPH_ISSUE_REPO, RALPH_ISSUE_CLOSE_ON_COMPLETE,"
  echo "                   RALPH_ISSUE_COMMENT_PROGRESS"
  echo ""
  echo "Precedence: CLI flags > env vars > config file > built-in defaults"
  echo ""
  echo "Examples:"
  echo "  $0 10                                        # 10 iterations per plan (default: 5)"
  echo "  $0 0                                         # unlimited iterations per plan"
  echo "  $0 --dry-run                                 # preview only"
  echo "  $0 10 --dry-run                              # preview with explicit iterations"
  echo "  $0 10 --resume                               # recover dirty state and continue"
  echo "  $0 10 --agent-command='claude -p'             # use Claude Code"
  echo "  $0 10 --agent-command='opencode run --agent build'  # use OpenCode"
  echo "  $0 10 --direct                               # commit on current branch (no PR)"
  echo "  RALPH_AGENT_COMMAND='codex exec' $0 10       # override via env var"
  echo ""
  echo "Feature branch workflow:"
  echo "  $0 10 --direct --base-branch=feature/big-thing  # commit directly on a feature branch"
}

# --- Parse args ---
for arg in "$@"; do
  case "$arg" in
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
        IFS=',' read -ra _fc_parts <<< "$CLI_FEEDBACK_COMMANDS"
        for _fc in "${_fc_parts[@]}"; do
          _trimmed_fc=$(echo "$_fc" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
          if [[ -z "$_trimmed_fc" ]]; then
            echo "ERROR: --feedback-commands contains an empty entry"
            exit 1
          fi
        done
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
      if [[ ! "$CLI_MAX_STUCK" =~ ^[1-9][0-9]*$ ]]; then
        echo "ERROR: --max-stuck must be a positive integer, got '$CLI_MAX_STUCK'"
        exit 1
      fi
      ;;
    --iteration-timeout=*)
      CLI_ITERATION_TIMEOUT="${arg#--iteration-timeout=}"
      if [[ ! "$CLI_ITERATION_TIMEOUT" =~ ^[0-9]+$ ]]; then
        echo "ERROR: --iteration-timeout must be a non-negative integer (seconds), got '$CLI_ITERATION_TIMEOUT'"
        exit 1
      fi
      ;;
    --direct)
      CLI_MODE="direct"
      ;;
    --pr)
      CLI_MODE="pr"
      ;;
    --prompt-mode=*)
      CLI_PROMPT_MODE="${arg#--prompt-mode=}"
      if [[ "$CLI_PROMPT_MODE" != "auto" && "$CLI_PROMPT_MODE" != "at-path" && "$CLI_PROMPT_MODE" != "inline" ]]; then
        echo "ERROR: --prompt-mode must be 'auto', 'at-path', or 'inline', got '$CLI_PROMPT_MODE'"
        exit 1
      fi
      ;;
    --issue-source=*)
      CLI_ISSUE_SOURCE="${arg#--issue-source=}"
      if [[ "$CLI_ISSUE_SOURCE" != "none" && "$CLI_ISSUE_SOURCE" != "github" ]]; then
        echo "ERROR: --issue-source must be 'none' or 'github', got '$CLI_ISSUE_SOURCE'"
        exit 1
      fi
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
      if [[ "$CLI_ISSUE_CLOSE_ON_COMPLETE" != "true" && "$CLI_ISSUE_CLOSE_ON_COMPLETE" != "false" ]]; then
        echo "ERROR: --issue-close-on-complete must be 'true' or 'false', got '$CLI_ISSUE_CLOSE_ON_COMPLETE'"
        exit 1
      fi
      ;;
    --issue-comment-progress=*)
      CLI_ISSUE_COMMENT_PROGRESS="${arg#--issue-comment-progress=}"
      if [[ "$CLI_ISSUE_COMMENT_PROGRESS" != "true" && "$CLI_ISSUE_COMMENT_PROGRESS" != "false" ]]; then
        echo "ERROR: --issue-comment-progress must be 'true' or 'false', got '$CLI_ISSUE_COMMENT_PROGRESS'"
        exit 1
      fi
      ;;
    *)
      if [[ -z "$ITERATIONS" && "$arg" =~ ^[0-9]+$ ]]; then
        ITERATIONS="$arg"
      else
        echo "ERROR: Unrecognized argument: $arg"
        print_usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$ITERATIONS" ]]; then
  ITERATIONS="5"
fi

if ! [[ "$ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: iterations must be a non-negative integer, got '$ITERATIONS'"
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
if [[ -n "$CLI_MODE" ]]; then
  MODE="$CLI_MODE"
fi
if [[ -n "$CLI_ITERATION_TIMEOUT" ]]; then
  ITERATION_TIMEOUT="$CLI_ITERATION_TIMEOUT"
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

# --- Show resolved config and exit ---
if [[ "$SHOW_CONFIG" == true ]]; then
  echo "Resolved settings (precedence: CLI > env > config > defaults):"
  echo ""

  # Determine source for each setting
  if [[ -n "$CLI_AGENT_COMMAND" ]]; then
    agent_command_source="cli (--agent-command=$CLI_AGENT_COMMAND)"
  elif [[ -n "${RALPH_AGENT_COMMAND:-}" ]]; then
    agent_command_source="env (RALPH_AGENT_COMMAND=$RALPH_AGENT_COMMAND)"
  elif [[ -n "${CONFIG_AGENT_COMMAND:-}" ]]; then
    agent_command_source="config ($CONFIG_FILE)"
  else
    agent_command_source="default (none)"
  fi

  if [[ -n "$CLI_FEEDBACK_COMMANDS" ]]; then
    feedback_commands_source="cli (--feedback-commands=$CLI_FEEDBACK_COMMANDS)"
  elif [[ -n "${RALPH_FEEDBACK_COMMANDS:-}" ]]; then
    feedback_commands_source="env (RALPH_FEEDBACK_COMMANDS=$RALPH_FEEDBACK_COMMANDS)"
  elif [[ -n "${CONFIG_FEEDBACK_COMMANDS:-}" ]]; then
    feedback_commands_source="config ($CONFIG_FILE)"
  else
    feedback_commands_source="default (none)"
  fi

  if [[ -n "$CLI_BASE_BRANCH" ]]; then
    branch_source="cli (--base-branch=$CLI_BASE_BRANCH)"
  elif [[ -n "${RALPH_BASE_BRANCH:-}" ]]; then
    branch_source="env (RALPH_BASE_BRANCH=$RALPH_BASE_BRANCH)"
  elif [[ -n "${CONFIG_BASE_BRANCH:-}" ]]; then
    branch_source="config ($CONFIG_FILE)"
  else
    branch_source="default"
  fi

  if [[ -n "$CLI_MAX_STUCK" ]]; then
    stuck_source="cli (--max-stuck=$CLI_MAX_STUCK)"
  elif [[ -n "${RALPH_MAX_STUCK:-}" ]]; then
    stuck_source="env (RALPH_MAX_STUCK=$RALPH_MAX_STUCK)"
  elif [[ -n "${CONFIG_MAX_STUCK:-}" ]]; then
    stuck_source="config ($CONFIG_FILE)"
  else
    stuck_source="default"
  fi

  if [[ -n "$CLI_MODE" ]]; then
    mode_source="cli (--${MODE})"
  elif [[ -n "${RALPH_MODE:-}" ]]; then
    mode_source="env (RALPH_MODE=$RALPH_MODE)"
  elif [[ -n "${CONFIG_MODE:-}" ]]; then
    mode_source="config ($CONFIG_FILE)"
  else
    mode_source="default"
  fi

  if [[ -n "$CLI_ITERATION_TIMEOUT" ]]; then
    timeout_source="cli (--iteration-timeout=$CLI_ITERATION_TIMEOUT)"
  elif [[ -n "${RALPH_ITERATION_TIMEOUT:-}" ]]; then
    timeout_source="env (RALPH_ITERATION_TIMEOUT=$RALPH_ITERATION_TIMEOUT)"
  elif [[ -n "${CONFIG_ITERATION_TIMEOUT:-}" ]]; then
    timeout_source="config ($CONFIG_FILE)"
  else
    timeout_source="default"
  fi

  if [[ -n "$CLI_ISSUE_SOURCE" ]]; then
    issue_source_source="cli (--issue-source=$CLI_ISSUE_SOURCE)"
  elif [[ -n "${RALPH_ISSUE_SOURCE:-}" ]]; then
    issue_source_source="env (RALPH_ISSUE_SOURCE=$RALPH_ISSUE_SOURCE)"
  elif [[ -n "${CONFIG_ISSUE_SOURCE:-}" ]]; then
    issue_source_source="config ($CONFIG_FILE)"
  else
    issue_source_source="default"
  fi

  if [[ -n "$CLI_ISSUE_LABEL" ]]; then
    issue_label_source="cli (--issue-label=$CLI_ISSUE_LABEL)"
  elif [[ -n "${RALPH_ISSUE_LABEL:-}" ]]; then
    issue_label_source="env (RALPH_ISSUE_LABEL=$RALPH_ISSUE_LABEL)"
  elif [[ -n "${CONFIG_ISSUE_LABEL:-}" ]]; then
    issue_label_source="config ($CONFIG_FILE)"
  else
    issue_label_source="default"
  fi

  if [[ -n "$CLI_ISSUE_IN_PROGRESS_LABEL" ]]; then
    issue_ip_label_source="cli (--issue-in-progress-label=$CLI_ISSUE_IN_PROGRESS_LABEL)"
  elif [[ -n "${RALPH_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    issue_ip_label_source="env (RALPH_ISSUE_IN_PROGRESS_LABEL=$RALPH_ISSUE_IN_PROGRESS_LABEL)"
  elif [[ -n "${CONFIG_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    issue_ip_label_source="config ($CONFIG_FILE)"
  else
    issue_ip_label_source="default"
  fi

  if [[ -n "$CLI_ISSUE_REPO" ]]; then
    issue_repo_source="cli (--issue-repo=$CLI_ISSUE_REPO)"
  elif [[ -n "${RALPH_ISSUE_REPO:-}" ]]; then
    issue_repo_source="env (RALPH_ISSUE_REPO=$RALPH_ISSUE_REPO)"
  elif [[ -n "${CONFIG_ISSUE_REPO:-}" ]]; then
    issue_repo_source="config ($CONFIG_FILE)"
  else
    issue_repo_source="default (auto-detect)"
  fi

  if [[ -n "$CLI_ISSUE_CLOSE_ON_COMPLETE" ]]; then
    issue_close_source="cli (--issue-close-on-complete=$CLI_ISSUE_CLOSE_ON_COMPLETE)"
  elif [[ -n "${RALPH_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    issue_close_source="env (RALPH_ISSUE_CLOSE_ON_COMPLETE=$RALPH_ISSUE_CLOSE_ON_COMPLETE)"
  elif [[ -n "${CONFIG_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    issue_close_source="config ($CONFIG_FILE)"
  else
    issue_close_source="default"
  fi

  if [[ -n "$CLI_ISSUE_COMMENT_PROGRESS" ]]; then
    issue_comment_source="cli (--issue-comment-progress=$CLI_ISSUE_COMMENT_PROGRESS)"
  elif [[ -n "${RALPH_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    issue_comment_source="env (RALPH_ISSUE_COMMENT_PROGRESS=$RALPH_ISSUE_COMMENT_PROGRESS)"
  elif [[ -n "${CONFIG_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    issue_comment_source="config ($CONFIG_FILE)"
  else
    issue_comment_source="default"
  fi

  if [[ -n "$CLI_PROMPT_MODE" ]]; then
    prompt_mode_source="cli (--prompt-mode=$CLI_PROMPT_MODE)"
  elif [[ -n "${RALPH_PROMPT_MODE:-}" ]]; then
    prompt_mode_source="env (RALPH_PROMPT_MODE=$RALPH_PROMPT_MODE)"
  elif [[ -n "${CONFIG_PROMPT_MODE:-}" ]]; then
    prompt_mode_source="config ($CONFIG_FILE)"
  else
    prompt_mode_source="default"
  fi

  echo "  agentCommand       = ${AGENT_COMMAND:-<none>}  ($agent_command_source)"
  echo "  feedbackCommands   = ${FEEDBACK_COMMANDS:-<none>}  ($feedback_commands_source)"
  echo "  baseBranch         = $BASE_BRANCH  ($branch_source)"
  echo "  mode               = $MODE  ($mode_source)"
  echo "  maxStuck           = $MAX_STUCK  ($stuck_source)"
  if [[ "$ITERATION_TIMEOUT" -gt 0 ]]; then
    echo "  iterationTimeout   = ${ITERATION_TIMEOUT}s  ($timeout_source)"
  else
    echo "  iterationTimeout   = off  ($timeout_source)"
  fi
  echo "  promptMode         = $PROMPT_MODE  ($prompt_mode_source)"
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
  if [[ -f "$CONFIG_FILE" ]]; then
    echo "Config file: $CONFIG_FILE (loaded)"
  else
    echo "Config file: $CONFIG_FILE (not found, using defaults)"
  fi
  exit 0
fi

# --- Validate agentCommand is set ---
if [[ -z "$AGENT_COMMAND" ]]; then
  echo "ERROR: agentCommand is required. Set it in .ralph/ralph.config, RALPH_AGENT_COMMAND env var, or --agent-command= flag."
  echo "Examples: agentCommand=opencode run --agent build"
  echo "          agentCommand=claude -p"
  echo "          agentCommand=codex exec"
  exit 1
fi

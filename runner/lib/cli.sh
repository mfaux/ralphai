# cli.sh — CLI argument parsing, config precedence orchestration,
# and agent command validation.
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
  echo "                  issueSource, issueLabel,"
  echo "                  issueInProgressLabel, issueRepo,"
  echo "                  issueCloseOnComplete, issueCommentProgress"
  echo ""
  echo "Env var overrides: RALPHAI_AGENT_COMMAND, RALPHAI_FEEDBACK_COMMANDS,"
  echo "                   RALPHAI_BASE_BRANCH, RALPHAI_MAX_STUCK,"
  echo "                   RALPHAI_MODE, RALPHAI_CONTINUOUS,"
  echo "                   RALPHAI_AUTO_COMMIT, RALPHAI_TURNS,"
  echo "                   RALPHAI_TURN_TIMEOUT,"
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
if [[ -n "$CLI_AUTO_COMMIT" ]]; then
  AUTO_COMMIT="$CLI_AUTO_COMMIT"
fi

# --- Validate agentCommand is set ---
if [[ -z "$AGENT_COMMAND" ]]; then
  echo "ERROR: agentCommand is required. Set it in ralphai.json, RALPHAI_AGENT_COMMAND env var, or --agent-command= flag."
  echo "Examples: \"agentCommand\": \"opencode run --agent build\""
  echo "          \"agentCommand\": \"claude -p\""
  echo "          \"agentCommand\": \"codex exec\""
  exit 1
fi

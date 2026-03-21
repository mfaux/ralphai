# cli.sh — CLI argument parsing, config resolution via TypeScript,
# and agent command validation.
# Sourced by ralphai.sh after config.sh. Runs at source-time.
# Depends on: defaults.sh (path constants, runtime flags),
#             config.sh (resolve_config — calls the TS config-cli)

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
  echo "  --allow-dirty                    Skip the clean working tree check"
  echo "  --agent-command=<command>        Override agent CLI command (e.g. 'claude -p')"
  echo "  --feedback-commands=<list>       Comma-separated feedback commands (e.g. 'npm test,npm run build')"
  echo "  --base-branch=<branch>           Override base branch (default: main)"
  echo "  --branch                         Branch mode (default): create isolated branch, commit, no PR"
  echo "  --pr                             PR mode: create branch, push, and open PR"
  echo "  --patch                          Patch mode: leave changes uncommitted in working tree"
  echo "  --continuous                     Keep processing backlog plans after the first completes"
  echo "  --max-stuck=<n>                  Override stuck threshold (default: 3)"
  echo "  --turn-timeout=<seconds>         Timeout per agent invocation (default: 0 = no timeout)"
  echo "  --auto-commit                    Enable auto-commit of agent changes (per-turn and resume recovery)"
  echo "  --no-auto-commit                 Disable auto-commit (default; only meaningful in patch mode)"
  echo "  --prompt-mode=<mode>             Prompt file ref format: 'auto', 'at-path', or 'inline' (default: auto)"
  echo "  --issue-source=<source>          Issue source: 'none' or 'github' (default: none)"
  echo "  --issue-label=<label>            Label to filter issues by (default: ralphai)"
  echo "  --issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)"
  echo "  --issue-repo=<owner/repo>        Override repo for issue operations (default: auto-detect)"
  echo "  --issue-comment-progress=<bool>  Comment on issue during run (default: true)"
  echo "  --show-config                    Print resolved settings and exit"
  echo "  --help, -h                       Show this help message"
  echo ""
  echo "Config file: $CONFIG_FILE (optional, JSON format)"
  echo "  Supported keys: agentCommand, feedbackCommands, baseBranch, maxStuck,"
  echo "                  mode, continuous, autoCommit, turns, turnTimeout, promptMode,"
  echo "                  issueSource, issueLabel,"
  echo "                  issueInProgressLabel, issueRepo,"
  echo "                  issueCommentProgress"
  echo ""
  echo "Env var overrides: RALPHAI_AGENT_COMMAND, RALPHAI_FEEDBACK_COMMANDS,"
  echo "                   RALPHAI_BASE_BRANCH, RALPHAI_MAX_STUCK,"
  echo "                   RALPHAI_MODE, RALPHAI_CONTINUOUS,"
  echo "                   RALPHAI_AUTO_COMMIT, RALPHAI_TURNS,"
  echo "                   RALPHAI_TURN_TIMEOUT,"
  echo "                   RALPHAI_PROMPT_MODE,"
  echo "                   RALPHAI_ISSUE_SOURCE,"
  echo "                   RALPHAI_ISSUE_LABEL, RALPHAI_ISSUE_IN_PROGRESS_LABEL,"
  echo "                   RALPHAI_ISSUE_REPO,"
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

# --- Parse non-config flags and reject unknown args ---
# Config-related args are passed through to the TS config resolver.
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
    --allow-dirty)
      ALLOW_DIRTY=true
      ;;
    --show-config)
      SHOW_CONFIG=true
      ;;
    # Config args — recognized here to avoid "Unrecognized argument" errors,
    # but actual parsing and validation is done by the TS config resolver.
    --turns=*|--agent-command=*|--feedback-commands=*|--base-branch=*|\
    --max-stuck=*|--turn-timeout=*|--branch|--pr|--patch|--continuous|\
    --auto-commit|--no-auto-commit|--prompt-mode=*|--issue-source=*|\
    --issue-label=*|--issue-in-progress-label=*|--issue-repo=*|\
    --issue-comment-progress=*)
      : # Handled by TS config resolver
      ;;
    *)
      echo "ERROR: Unrecognized argument: $arg"
      print_usage
      exit 1
      ;;
  esac
done

# --- Resolve config via TypeScript ---
# The TS config-cli resolves: defaults -> config file -> env vars -> CLI args.
# It handles all validation (enum checks, integer checks, etc.).
if [[ "$SHOW_CONFIG" == true ]]; then
  # --show-config: config-cli prints the formatted output directly.
  # Pass worktree info via env vars for the show-config display.
  export RALPHAI_IS_WORKTREE
  export RALPHAI_MAIN_WORKTREE
  node "$_CONFIG_CLI" "$CONFIG_FILE" --show-config "$@"
  exit 0
fi

resolve_config "$@"

# --- Validate agentCommand is set ---
if [[ -z "$AGENT_COMMAND" ]]; then
  echo "ERROR: agentCommand is required. Set it in ralphai.json, RALPHAI_AGENT_COMMAND env var, or --agent-command= flag."
  echo "Examples: \"agentCommand\": \"opencode run --agent build\""
  echo "          \"agentCommand\": \"claude -p\""
  echo "          \"agentCommand\": \"codex exec\""
  exit 1
fi

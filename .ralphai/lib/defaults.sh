# defaults.sh — Built-in defaults, resolved settings, path constants, and runtime flags.
# Sourced by ralphai.sh. No functions — only variable declarations.

# --- Built-in defaults ---
DEFAULT_AGENT_COMMAND=""
DEFAULT_FEEDBACK_COMMANDS=""
DEFAULT_BASE_BRANCH="main"
DEFAULT_MAX_STUCK=3
DEFAULT_MODE="direct"                # "direct" (default) or "pr"
DEFAULT_ISSUE_SOURCE="none"              # set to "github" to enable GitHub Issues integration
DEFAULT_ISSUE_LABEL="ralphai"             # label to filter issues by
DEFAULT_ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"  # label applied when issue is picked up
DEFAULT_ISSUE_REPO=""                    # owner/repo override (auto-detected from git remote)
DEFAULT_ISSUE_CLOSE_ON_COMPLETE="true"   # auto-close linked GitHub issues on plan completion
DEFAULT_ISSUE_COMMENT_PROGRESS="true"    # comment on issue during run
DEFAULT_TURN_TIMEOUT=0                   # 0 = no timeout (seconds per agent invocation)
DEFAULT_PROMPT_MODE="auto"               # "auto", "at-path", or "inline"

# --- Resolved settings (will be overridden by config/env/CLI) ---
AGENT_COMMAND="$DEFAULT_AGENT_COMMAND"
FEEDBACK_COMMANDS="$DEFAULT_FEEDBACK_COMMANDS"
MAX_STUCK="$DEFAULT_MAX_STUCK"
BASE_BRANCH="$DEFAULT_BASE_BRANCH"
MODE="$DEFAULT_MODE"
ISSUE_SOURCE="$DEFAULT_ISSUE_SOURCE"
ISSUE_LABEL="$DEFAULT_ISSUE_LABEL"
ISSUE_IN_PROGRESS_LABEL="$DEFAULT_ISSUE_IN_PROGRESS_LABEL"
ISSUE_REPO="$DEFAULT_ISSUE_REPO"
ISSUE_CLOSE_ON_COMPLETE="$DEFAULT_ISSUE_CLOSE_ON_COMPLETE"
ISSUE_COMMENT_PROGRESS="$DEFAULT_ISSUE_COMMENT_PROGRESS"
TURN_TIMEOUT="$DEFAULT_TURN_TIMEOUT"
PROMPT_MODE="$DEFAULT_PROMPT_MODE"

WIP_DIR=".ralphai/pipeline/in-progress"
BACKLOG_DIR=".ralphai/pipeline/backlog"
ARCHIVE_DIR=".ralphai/pipeline/out"
CONFIG_FILE=".ralphai/ralphai.config"
PROGRESS_FILE="$WIP_DIR/progress.txt"
GROUP_STATE_FILE="$WIP_DIR/.group-state"

# --- Group mode state (populated by read_group_state / detect_plan) ---
GROUP_NAME=""
GROUP_BRANCH=""
GROUP_PLANS_TOTAL=0
GROUP_PLANS_COMPLETED=0
GROUP_CURRENT_PLAN=""
GROUP_PR_URL=""

DRY_RUN=false
RESUME=false
TURNS=""
CLI_AGENT_COMMAND=""
CLI_FEEDBACK_COMMANDS=""
CLI_BASE_BRANCH=""
CLI_MAX_STUCK=""
CLI_MODE=""
CLI_TURN_TIMEOUT=""
CLI_ISSUE_SOURCE=""
CLI_ISSUE_LABEL=""
CLI_ISSUE_IN_PROGRESS_LABEL=""
CLI_ISSUE_REPO=""
CLI_ISSUE_CLOSE_ON_COMPLETE=""
CLI_ISSUE_COMMENT_PROGRESS=""
CLI_PROMPT_MODE=""
SHOW_CONFIG=false

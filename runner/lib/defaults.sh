# defaults.sh — Built-in defaults, resolved settings, path constants, and runtime flags.
# Sourced by ralphai.sh. No functions — only variable declarations.

# --- Built-in defaults ---
DEFAULT_AGENT_COMMAND=""
DEFAULT_FEEDBACK_COMMANDS=""
DEFAULT_BASE_BRANCH="main"
DEFAULT_MAX_STUCK=3
DEFAULT_MODE="branch"                # "branch" (default), "pr", or "patch"
DEFAULT_ISSUE_SOURCE="none"              # set to "github" to enable GitHub Issues integration
DEFAULT_ISSUE_LABEL="ralphai"             # label to filter issues by
DEFAULT_ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"  # label applied when issue is picked up
DEFAULT_ISSUE_REPO=""                    # owner/repo override (auto-detected from git remote)
DEFAULT_ISSUE_COMMENT_PROGRESS="true"    # comment on issue during run
DEFAULT_TURN_TIMEOUT=0                   # 0 = no timeout (seconds per agent invocation)
DEFAULT_PROMPT_MODE="auto"               # "auto", "at-path", or "inline"
DEFAULT_CONTINUOUS="false"               # "true" to keep draining backlog after first plan
DEFAULT_AUTO_COMMIT="false"              # "true" to auto-commit after turns / on resume (patch mode)
DEFAULT_MAX_LEARNINGS=20                 # max entries kept in LEARNINGS.md (0 = unlimited)

# --- Resolved settings (will be overridden by config/env/CLI) ---
AGENT_COMMAND="$DEFAULT_AGENT_COMMAND"
FEEDBACK_COMMANDS="$DEFAULT_FEEDBACK_COMMANDS"
MAX_STUCK="$DEFAULT_MAX_STUCK"
BASE_BRANCH="$DEFAULT_BASE_BRANCH"
MODE="$DEFAULT_MODE"
CONTINUOUS="$DEFAULT_CONTINUOUS"
ISSUE_SOURCE="$DEFAULT_ISSUE_SOURCE"
ISSUE_LABEL="$DEFAULT_ISSUE_LABEL"
ISSUE_IN_PROGRESS_LABEL="$DEFAULT_ISSUE_IN_PROGRESS_LABEL"
ISSUE_REPO="$DEFAULT_ISSUE_REPO"
ISSUE_COMMENT_PROGRESS="$DEFAULT_ISSUE_COMMENT_PROGRESS"
TURN_TIMEOUT="$DEFAULT_TURN_TIMEOUT"
PROMPT_MODE="$DEFAULT_PROMPT_MODE"
AUTO_COMMIT="$DEFAULT_AUTO_COMMIT"
MAX_LEARNINGS="$DEFAULT_MAX_LEARNINGS"

WIP_DIR=".ralphai/pipeline/in-progress"
BACKLOG_DIR=".ralphai/pipeline/backlog"
ARCHIVE_DIR=".ralphai/pipeline/out"
PARKED_DIR=".ralphai/pipeline/parked"
CONFIG_FILE="ralphai.json"
PROGRESS_FILE="$WIP_DIR/<slug>/progress.md"

# --- Worktree detection ---
RALPHAI_IS_WORKTREE=false
RALPHAI_MAIN_WORKTREE=""

# Canonicalize with cd+pwd because --git-common-dir may return a relative path
# depending on git version and how the worktree was created.
_git_common_dir=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd || echo "$(pwd)/.git")
if [[ "$_git_common_dir" != "$(pwd)/.git" ]]; then
  RALPHAI_IS_WORKTREE=true
  # --git-common-dir returns e.g. /home/user/project/.git
  # Strip trailing /.git to get the main worktree root
  RALPHAI_MAIN_WORKTREE="${_git_common_dir%/.git}"
fi
unset _git_common_dir

if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
  if [[ -L ".ralphai" ]]; then
    # Symlink exists — keep the default relative paths for pipeline dirs.
    # The symlink resolves to the main repo's .ralphai/ directory, so
    # relative paths like .ralphai/pipeline/in-progress/ work correctly
    # AND stay within the agent's working directory (avoids "external
    # directory" rejection in sandboxed agents like OpenCode/Claude Code).
    # Config (ralphai.json) is resolved via symlink or checked-out copy,
    # so the default CONFIG_FILE="ralphai.json" already works.
    :
  else
    # No symlink — use absolute paths to the main repo's pipeline dirs
    # and config file (for manually-created worktrees without the symlink).
    WIP_DIR="$RALPHAI_MAIN_WORKTREE/.ralphai/pipeline/in-progress"
    BACKLOG_DIR="$RALPHAI_MAIN_WORKTREE/.ralphai/pipeline/backlog"
    ARCHIVE_DIR="$RALPHAI_MAIN_WORKTREE/.ralphai/pipeline/out"
    PARKED_DIR="$RALPHAI_MAIN_WORKTREE/.ralphai/pipeline/parked"
    CONFIG_FILE="$RALPHAI_MAIN_WORKTREE/ralphai.json"
    PROGRESS_FILE="$WIP_DIR/<slug>/progress.md"
  fi
fi

DRY_RUN=false
RESUME=false
TURNS=""
CONFIG_TURNS=""
CLI_AGENT_COMMAND=""
CLI_FEEDBACK_COMMANDS=""
CLI_BASE_BRANCH=""
CLI_MAX_STUCK=""
CLI_MODE=""
CLI_CONTINUOUS=""
CLI_TURN_TIMEOUT=""
CLI_ISSUE_SOURCE=""
CLI_ISSUE_LABEL=""
CLI_ISSUE_IN_PROGRESS_LABEL=""
CLI_ISSUE_REPO=""
CLI_ISSUE_COMMENT_PROGRESS=""
CLI_PROMPT_MODE=""
CLI_AUTO_COMMIT=""
CLI_TURNS=""
SHOW_CONFIG=false

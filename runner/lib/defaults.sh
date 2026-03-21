# defaults.sh — Path constants, worktree detection, CLI path variables,
# and runtime flags.
# Sourced by ralphai.sh. No functions — only variable declarations.
#
# Default config values and validation have moved to TypeScript (src/config.ts).
# This file retains path constants, worktree detection, and runtime flags.

# --- Path constants ---
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

    # Warn if .ralphai/ exists as a real directory — plans there will be ignored.
    if [[ -d ".ralphai" ]]; then
      echo "WARNING: .ralphai/ exists in this worktree but is not a symlink."
      echo "  Pipeline dirs resolve to the main repo: $RALPHAI_MAIN_WORKTREE/.ralphai/"
      echo "  Plans in $(pwd)/.ralphai/pipeline/backlog/ will be ignored."
      echo "  Fix: replace with a symlink, or use 'ralphai worktree' to create worktrees."
      echo ""
    fi
  fi
fi

# --- CLI paths ---
# All frontmatter parsing delegates to the TypeScript module via Node.
# The compiled CLI lives at <package-root>/dist/frontmatter-cli.mjs.
_FRONTMATTER_CLI="$RALPHAI_LIB_DIR/../../dist/frontmatter-cli.mjs"

# Receipt operations delegate to the TypeScript module via Node.
_RECEIPT_CLI="$RALPHAI_LIB_DIR/../../dist/receipt-cli.mjs"

# Scope/ecosystem detection delegates to the TypeScript module via Node.
_SCOPE_CLI="$RALPHAI_LIB_DIR/../../dist/scope-cli.mjs"

# Config resolution delegates to the TypeScript module via Node.
_CONFIG_CLI="$RALPHAI_LIB_DIR/../../dist/config-cli.mjs"

# Plan detection delegates to the TypeScript module via Node.
_PLAN_DETECTION_CLI="$RALPHAI_LIB_DIR/../../dist/plan-detection-cli.mjs"

# --- Runtime flags and resolved settings ---
# These are populated by cli.sh after calling the TS config resolver.
PLAN_SCOPE=""
CONFIG_WORKSPACES=""

DRY_RUN=false
RESUME=false
ALLOW_DIRTY=false
SHOW_CONFIG=false

# Resolved config settings — set by cli.sh via the TS config resolver.
# Initialized to empty strings; config-cli populates them.
AGENT_COMMAND=""
FEEDBACK_COMMANDS=""
BASE_BRANCH="main"
MAX_STUCK=3
MODE="branch"
CONTINUOUS="false"
ISSUE_SOURCE="none"
ISSUE_LABEL="ralphai"
ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"
ISSUE_REPO=""
ISSUE_COMMENT_PROGRESS="true"
TURN_TIMEOUT=0
PROMPT_MODE="auto"
AUTO_COMMIT="false"
TURNS=""
MAX_LEARNINGS=20

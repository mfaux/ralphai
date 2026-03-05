#!/bin/bash
# ralph.sh — Ralph (looped, autonomous)
# Drives an AI coding agent to autonomously implement tasks from plan files.
#
# Usage: .ralph/ralph.sh <iterations-per-plan> [--dry-run] [--resume] [--agent-command=<cmd>] [--feedback-commands=<list>] [--base-branch=<branch>] [--direct] [--pr] [--max-stuck=<n>] [--show-config] [--help]
#
# Auto-detects what to work on:
#   1. If .ralph/in-progress/ has plan files → resume on the current ralph/* branch
#   2. Otherwise, pick the best plan from .ralph/backlog/ (LLM-selected if multiple)
#
# On completion of a plan (PR mode, the default): pushes the branch and creates
# a PR via 'gh' CLI. In direct mode (--direct): commits on the current branch
# with no branch creation and no PR. Iteration budget resets for each new plan.
#
# On iteration exhaustion or stuck: exits, leaving files in in-progress/ for
# resume on a subsequent run.

set -e

# --- Built-in defaults ---
DEFAULT_AGENT_COMMAND=""
DEFAULT_FEEDBACK_COMMANDS=""
DEFAULT_BASE_BRANCH="main"
DEFAULT_MAX_STUCK=3
DEFAULT_MODE="pr"                    # "pr" (default) or "direct"
DEFAULT_ISSUE_SOURCE="none"              # set to "github" to enable GitHub Issues integration
DEFAULT_ISSUE_LABEL="ralphai"             # label to filter issues by
DEFAULT_ISSUE_IN_PROGRESS_LABEL="ralphai:in-progress"  # label applied when issue is picked up
DEFAULT_ISSUE_REPO=""                    # owner/repo override (auto-detected from git remote)
DEFAULT_ISSUE_CLOSE_ON_COMPLETE="true"   # auto-close linked GitHub issues on plan completion
DEFAULT_ISSUE_COMMENT_PROGRESS="true"    # comment on issue during run
DEFAULT_ITERATION_TIMEOUT=0              # 0 = no timeout (seconds per agent invocation)

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
ITERATION_TIMEOUT="$DEFAULT_ITERATION_TIMEOUT"

WIP_DIR=".ralph/in-progress"
BACKLOG_DIR=".ralph/backlog"
ARCHIVE_DIR=".ralph/out"
CONFIG_FILE=".ralph/ralph.config"
PROGRESS_FILE="$WIP_DIR/progress.txt"
DRY_RUN=false
RESUME=false
ITERATIONS=""
CLI_AGENT_COMMAND=""
CLI_FEEDBACK_COMMANDS=""
CLI_BASE_BRANCH=""
CLI_MAX_STUCK=""
CLI_MODE=""
CLI_ITERATION_TIMEOUT=""
CLI_ISSUE_SOURCE=""
CLI_ISSUE_LABEL=""
CLI_ISSUE_IN_PROGRESS_LABEL=""
CLI_ISSUE_REPO=""
CLI_ISSUE_CLOSE_ON_COMPLETE=""
CLI_ISSUE_COMMENT_PROGRESS=""
SHOW_CONFIG=false

# --- Config file loader ---
# Parses .ralph/ralph.config (key=value, comments, blank lines).
# Sets CONFIG_AGENT_COMMAND, CONFIG_FEEDBACK_COMMANDS, CONFIG_BASE_BRANCH,
# CONFIG_MAX_STUCK, CONFIG_MODE when present.
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
      *)
        echo "ERROR: $config_path:$line_num: unknown config key '$key'"
        echo "Supported keys: agentCommand, feedbackCommands, baseBranch, maxStuck, mode, issueSource, issueLabel, issueInProgressLabel, issueRepo, issueCloseOnComplete, issueCommentProgress, iterationTimeout"
        exit 1
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
}

# ---------------------------------------------------------------------------
# Issue integration helpers
# ---------------------------------------------------------------------------

check_gh_available() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  return 0
}

read_issue_frontmatter() {
  local plan_file="$1"
  PLAN_ISSUE_SOURCE=""
  PLAN_ISSUE_NUMBER=""
  PLAN_ISSUE_URL=""

  [[ -f "$plan_file" ]] || return 1
  head -1 "$plan_file" | grep -q '^---$' || return 1

  PLAN_ISSUE_SOURCE=$(sed -n '/^---$/,/^---$/{ /^source:[[:space:]]/{ s/^source:[[:space:]]*//; p; } }' "$plan_file")
  PLAN_ISSUE_NUMBER=$(sed -n '/^---$/,/^---$/{ /^issue:[[:space:]]/{ s/^issue:[[:space:]]*//; p; } }' "$plan_file")
  PLAN_ISSUE_URL=$(sed -n '/^---$/,/^---$/{ /^issue-url:[[:space:]]/{ s/^issue-url:[[:space:]]*//; p; } }' "$plan_file")
}

detect_repo_from_url() {
  local url="$1"
  echo "$url" | sed -E 's#https://github\.com/([^/]+/[^/]+)/issues/.*#\1#'
}

# Prints owner/repo from ISSUE_REPO or auto-detects from git remote origin.
detect_issue_repo() {
  if [[ -n "$ISSUE_REPO" ]]; then
    echo "$ISSUE_REPO"
    return
  fi
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 1
  # Handle SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
  echo "$url" | sed -E 's#(git@|https://)github\.com[:/]##; s/\.git$//'
}

# Converts a string to a filename-safe lowercase slug (max 60 chars).
slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | head -c 60
}

# Pulls the oldest open GitHub issue with the configured label, converts it
# to a plan file, and drops it in the backlog directory.  Returns 0 on
# success (plan file created), 1 otherwise.
pull_github_issues() {
  [[ "$ISSUE_SOURCE" == "github" ]] || return 1

  check_gh_available || {
    log "gh CLI not available or not authenticated — skipping issue pull"
    return 1
  }

  local repo
  repo=$(detect_issue_repo) || {
    log "Could not detect GitHub repo — skipping issue pull"
    return 1
  }

  # Get the oldest open issue with the configured label.
  # gh issue list returns newest first; use --jq 'last' to pick the oldest.
  local number
  number=$(gh issue list \
    --repo "$repo" \
    --label "$ISSUE_LABEL" \
    --state open \
    --limit 100 \
    --json number \
    --jq 'if length == 0 then empty else last.number end' 2>/dev/null) || return 1

  [[ -n "$number" ]] || return 1

  # Fetch full issue details using gh issue view
  local title body url slug filename
  title=$(gh issue view "$number" --repo "$repo" --json title --jq '.title' 2>/dev/null) || return 1
  body=$(gh issue view "$number" --repo "$repo" --json body --jq '.body' 2>/dev/null) || return 1
  url=$(gh issue view "$number" --repo "$repo" --json url --jq '.url' 2>/dev/null) || return 1

  slug=$(slugify "$title")
  filename="gh-${number}-${slug}.md"

  # Write plan file with frontmatter
  cat > "$BACKLOG_DIR/$filename" <<PLAN_EOF
---
source: github
issue: ${number}
issue-url: ${url}
---

# ${title}

${body}
PLAN_EOF

  # Update issue labels: add in-progress, remove intake label
  gh issue edit "$number" \
    --repo "$repo" \
    --add-label "$ISSUE_IN_PROGRESS_LABEL" \
    --remove-label "$ISSUE_LABEL" >/dev/null 2>&1

  if [[ "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
    gh issue comment "$number" \
      --repo "$repo" \
      --body "Ralph picked up this issue and created a plan file. Working on it now." >/dev/null 2>&1
  fi

  log "Pulled GitHub issue #${number}: ${title} → ${filename}"
  return 0
}

# Reads issue-related frontmatter from a plan file.
# Sets global variables: PLAN_ISSUE_SOURCE, PLAN_ISSUE_NUMBER, PLAN_ISSUE_URL
read_issue_frontmatter() {
  local plan_file="$1"
  PLAN_ISSUE_SOURCE=""
  PLAN_ISSUE_NUMBER=""
  PLAN_ISSUE_URL=""
  [[ -f "$plan_file" ]] || return
  if head -1 "$plan_file" | grep -q '^---$'; then
    PLAN_ISSUE_SOURCE=$(sed -n '/^---$/,/^---$/{ /^source:/{ s/^source:[[:space:]]*//; p; } }' "$plan_file")
    PLAN_ISSUE_NUMBER=$(sed -n '/^---$/,/^---$/{ /^issue:/{ s/^issue:[[:space:]]*//; p; } }' "$plan_file")
    PLAN_ISSUE_URL=$(sed -n '/^---$/,/^---$/{ /^issue-url:/{ s/^issue-url:[[:space:]]*//; p; } }' "$plan_file")
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
  echo "                  mode, iterationTimeout,"
  echo "                  issueSource, issueLabel, issueInProgressLabel, issueRepo,"
  echo "                  issueCloseOnComplete, issueCommentProgress"
  echo ""
  echo "Env var overrides: RALPH_AGENT_COMMAND, RALPH_FEEDBACK_COMMANDS,"
  echo "                   RALPH_BASE_BRANCH, RALPH_MAX_STUCK,"
  echo "                   RALPH_MODE, RALPH_ITERATION_TIMEOUT,"
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

is_tree_dirty() {
  if ! git diff --quiet HEAD 2>/dev/null; then
    return 0
  fi
  if ! git diff --cached --quiet 2>/dev/null; then
    return 0
  fi
  if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    return 0
  fi
  return 1
}

# --- Plan dependency helpers (optional frontmatter: depends-on) ---
# Supported forms in markdown frontmatter:
#   depends-on: [prd-a.md, prd-b.md]
#   depends-on:
#     - prd-a.md
#     - prd-b.md

# Read a plan's depends-on entries from YAML frontmatter and emit one dependency
# filename per line (basename form, e.g. prd-foo.md).
extract_depends_on() {
  local file="$1"

  # No frontmatter block
  if [[ ! -f "$file" ]] || [[ "$(head -1 "$file" 2>/dev/null)" != "---" ]]; then
    return 0
  fi

  awk '
    BEGIN {
      in_fm=0
      dep_mode=0
    }

    NR==1 && $0=="---" {
      in_fm=1
      next
    }

    in_fm && $0=="---" {
      exit
    }

    in_fm {
      line=$0

      # Inline array: depends-on: [a.md, b.md]
      if (match(line, /^[[:space:]]*depends-on:[[:space:]]*\[[^\]]*\][[:space:]]*$/)) {
        dep_mode=0
        sub(/^[[:space:]]*depends-on:[[:space:]]*\[/, "", line)
        sub(/\][[:space:]]*$/, "", line)
        n=split(line, parts, ",")
        for (i=1; i<=n; i++) {
          dep=parts[i]
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", dep)
          gsub(/^"|"$/, "", dep)
          gsub(/^\047|\047$/, "", dep)
          if (dep != "") print dep
        }
        next
      }

      # Start multiline list: depends-on:
      if (match(line, /^[[:space:]]*depends-on:[[:space:]]*$/)) {
        dep_mode=1
        next
      }

      # Collect list item when in depends-on block
      if (dep_mode == 1 && match(line, /^[[:space:]]*-[[:space:]]+/)) {
        dep=line
        sub(/^[[:space:]]*-[[:space:]]+/, "", dep)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", dep)
        gsub(/^"|"$/, "", dep)
        gsub(/^\047|\047$/, "", dep)
        if (dep != "") print dep
        next
      }

      # Any new top-level key ends depends-on block
      if (dep_mode == 1 && match(line, /^[[:alnum:]_-]+:[[:space:]]*/)) {
        dep_mode=0
      }
    }
  ' "$file"
}

# Return dependency status for a plan basename:
#   done    -> archived in out/
#   pending -> present in backlog/ or in-progress/
#   missing -> not found anywhere known
dependency_status() {
  local dep_base
  dep_base=$(basename "$1")

  if [[ -f "$ARCHIVE_DIR/$dep_base" ]]; then
    echo "done"
    return 0
  fi

  if compgen -G "$ARCHIVE_DIR/${dep_base%.md}-*.md" >/dev/null; then
    echo "done"
    return 0
  fi

  if [[ -f "$WIP_DIR/$dep_base" || -f "$BACKLOG_DIR/$dep_base" ]]; then
    echo "pending"
    return 0
  fi

  echo "missing"
}

# Determine whether a backlog plan is ready based on depends-on metadata.
# Prints "ready" when runnable, otherwise a reason string prefixed with
# "blocked:".
plan_readiness() {
  local plan="$1"
  local plan_base
  plan_base=$(basename "$plan")

  local deps=()
  while IFS= read -r dep; do
    [[ -n "$dep" ]] && deps+=("$(basename "$dep")")
  done < <(extract_depends_on "$plan")

  if [[ ${#deps[@]} -eq 0 ]]; then
    echo "ready"
    return 0
  fi

  local blocked_reasons=()
  for dep in "${deps[@]}"; do
    if [[ "$dep" == "$plan_base" ]]; then
      blocked_reasons+=("self:$dep")
      continue
    fi

    status=$(dependency_status "$dep")
    if [[ "$status" != "done" ]]; then
      blocked_reasons+=("$status:$dep")
    fi
  done

  if [[ ${#blocked_reasons[@]} -eq 0 ]]; then
    echo "ready"
    return 0
  fi

  local joined
  joined=$(IFS=','; echo "${blocked_reasons[*]}")
  echo "blocked:$joined"
}

# --- Parse args ---
if [[ $# -eq 0 ]]; then
  print_usage
  exit 1
fi

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

# --- Temporary compatibility: MERGE_TARGET and PROTECTED_BRANCHES ---
# TODO(task-3): Remove these when merge_and_cleanup() is replaced by create_pr()
MERGE_TARGET="$BASE_BRANCH"
PROTECTED_BRANCHES=""

# --- Helper: check if a branch is protected ---
is_branch_protected() {
  local branch_to_check="$1"
  if [[ -z "$PROTECTED_BRANCHES" ]]; then
    return 1
  fi
  IFS=',' read -ra _protected_list <<< "$PROTECTED_BRANCHES"
  for _pb in "${_protected_list[@]}"; do
    local trimmed
    trimmed=$(echo "$_pb" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [[ "$trimmed" == "$branch_to_check" ]]; then
      return 0
    fi
  done
  return 1
}

# --- Helper: check if a branch already has open work ---
# Returns 0 (collision found) or 1 (clear). Sets COLLISION_REASON.
COLLISION_REASON=""
branch_has_open_work() {
  local branch="$1"
  COLLISION_REASON=""

  # 1. Local branch exists
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    local pr_num=""
    if command -v gh &>/dev/null; then
      pr_num=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)
    fi
    if [[ -n "$pr_num" ]]; then
      COLLISION_REASON="Local branch '$branch' exists with open PR #${pr_num}"
    else
      COLLISION_REASON="Local branch '$branch' already exists"
    fi
    return 0
  fi

  # 2. Remote branch exists (local may have been deleted)
  if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    local pr_num=""
    if command -v gh &>/dev/null; then
      pr_num=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)
    fi
    if [[ -n "$pr_num" ]]; then
      COLLISION_REASON="Remote branch '$branch' exists with open PR #${pr_num}"
    else
      COLLISION_REASON="Remote branch 'origin/$branch' exists (possibly from a previous run)"
    fi
    return 0
  fi

  # 3. No branches found, but check for open PR (edge case: branches deleted, PR still open)
  if command -v gh &>/dev/null; then
    local pr_num
    pr_num=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number' 2>/dev/null || true)
    if [[ -n "$pr_num" ]]; then
      COLLISION_REASON="Open PR #${pr_num} exists for branch '$branch'"
      return 0
    fi
  fi

  return 1
}

# --- Plans skipped this session (branch/PR collision) ---
declare -A SKIPPED_PLANS

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
  echo "  issueSource        = $ISSUE_SOURCE  ($issue_source_source)"
  if [[ "$ISSUE_SOURCE" != "none" ]]; then
    echo "  issueLabel         = $ISSUE_LABEL  ($issue_label_source)"
    echo "  issueInProgressLabel = $ISSUE_IN_PROGRESS_LABEL  ($issue_ip_label_source)"
    echo "  issueRepo          = ${ISSUE_REPO:-<auto-detect>}  ($issue_repo_source)"
    echo "  issueCloseOnComplete = $ISSUE_CLOSE_ON_COMPLETE  ($issue_close_source)"
    echo "  issueCommentProgress = $ISSUE_COMMENT_PROGRESS  ($issue_comment_source)"
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

# --- PR mode preflight: validate gh CLI ---
# In PR mode (the default), ralph needs 'gh' to push branches and create PRs.
# Check early so the user finds out before the agent runs 10 iterations.
if [[ "$MODE" == "pr" && "$DRY_RUN" != true ]]; then
  if ! command -v gh &>/dev/null; then
    echo "ERROR: PR mode (the default) requires the GitHub CLI (gh)."
    echo "Install it: https://cli.github.com"
    echo "Or use --direct to commit on the current branch instead."
    exit 1
  fi
  if ! gh auth status &>/dev/null; then
    echo "ERROR: gh is installed but not authenticated."
    echo "Run 'gh auth login' first, or use --direct to skip PR creation."
    exit 1
  fi
fi

# --- Build feedback commands text for prompt ---
if [[ -n "$FEEDBACK_COMMANDS" ]]; then
  FEEDBACK_COMMANDS_TEXT=$(echo "$FEEDBACK_COMMANDS" | tr ',' ', ')
else
  FEEDBACK_COMMANDS_TEXT=""
fi

# --- Conditional LEARNINGS.md references ---
# Two-tier learnings: repo-level LEARNINGS.md is read-only context,
# .ralph/LEARNINGS.md is where Ralph writes its own learnings (gitignored).
LEARNINGS_REF=""
LEARNINGS_HINT=""
LEARNINGS_STEP=""
RALPH_LEARNINGS_FILE=".ralph/LEARNINGS.md"
if [[ -f "LEARNINGS.md" ]]; then
  LEARNINGS_REF=" @LEARNINGS.md"
  LEARNINGS_HINT=" Also read LEARNINGS.md to avoid repeating past mistakes."
fi
if [[ -f "$RALPH_LEARNINGS_FILE" ]]; then
  LEARNINGS_REF="$LEARNINGS_REF @$RALPH_LEARNINGS_FILE"
  LEARNINGS_HINT="${LEARNINGS_HINT:- }Also read $RALPH_LEARNINGS_FILE to avoid repeating past mistakes."
fi
if [[ -f "LEARNINGS.md" || -f "$RALPH_LEARNINGS_FILE" ]]; then
  LEARNINGS_STEP="
6. If you make a mistake (wrong assumption, broken build, misunderstood requirement, flawed approach), log it in $RALPH_LEARNINGS_FILE with the date, what went wrong, the root cause, and how to prevent it. Do NOT write to the repo-level LEARNINGS.md — that file is curated by the project maintainer. When useful, note high-value recurring patterns in progress.txt so the maintainer can compact and promote them into repo-level learnings and agent/skill docs."
fi

# --- Safety: handle dirty git state (normal mode only) ---
if [[ "$DRY_RUN" != true ]]; then
  if is_tree_dirty; then
    if [[ "$RESUME" == true ]]; then
      current_branch=$(git rev-parse --abbrev-ref HEAD)
      if [[ "$current_branch" == "$BASE_BRANCH" ]] || is_branch_protected "$current_branch"; then
        echo "ERROR: --resume refused on '$current_branch' branch (protected or base branch)."
        echo "Switch to your ralph/* branch first, then re-run with --resume."
        exit 1
      fi

      echo "Detected dirty state on $current_branch. Auto-committing recovery snapshot (--resume)."
      git add -A
      git commit -m "chore(ralph): recover interrupted iteration

Interrupted mid-iteration on branch $current_branch.
Committing dirty state so ralph.sh can resume." || true
    else
      echo "ERROR: Working tree is dirty. Commit or stash changes before running Ralph."
      echo "Tip: re-run with --resume to auto-commit and continue."
      exit 1
    fi
  fi
fi

# --- Verify base branch exists ---
if ! git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then
  echo "ERROR: Base branch '$BASE_BRANCH' not found."
  exit 1
fi

# --- Archive function: move PRD + progress from in-progress/ to out/ ---
# Only called on actual completion (COMPLETE signal).
archive_run() {
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$ARCHIVE_DIR"

  # Read issue frontmatter before files are moved (needed for post-completion hooks)
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      read_issue_frontmatter "$f"
      # Stop at the first file with github source frontmatter
      [[ "$PLAN_ISSUE_SOURCE" == "github" ]] && break
    fi
  done

  # Move progress file
  if [[ -f "$PROGRESS_FILE" ]]; then
    mv "$PROGRESS_FILE" "$ARCHIVE_DIR/progress-${timestamp}.txt"
    echo "Archived $PROGRESS_FILE -> $ARCHIVE_DIR/progress-${timestamp}.txt"
  fi

  # Move PRD/plan files from in-progress/ to out/
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      local basename
      basename=$(basename "$f")
      local dest="$ARCHIVE_DIR/${basename%.md}-${timestamp}.md"
      mv "$f" "$dest"
      echo "Archived $f -> $dest"
    fi
  done

  # Post progress comment on linked GitHub issue
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" && "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
    local repo
    repo=$(detect_issue_repo) && \
    gh issue comment "$PLAN_ISSUE_NUMBER" \
      --repo "$repo" \
      --body "Ralph completed this task. Archiving plan and preparing to merge." >/dev/null 2>&1
  fi

  # Plan files are gitignored (local-only state), so no git operations needed.
  # The mv commands above are the entire archive step.

  # Post completion comment on linked issue
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" ]]; then
    if check_gh_available; then
      local repo=""
      if [[ -n "$PLAN_ISSUE_URL" ]]; then
        repo=$(detect_repo_from_url "$PLAN_ISSUE_URL")
      else
        repo=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@|https://)github\.com[:/]##; s/\.git$//')
      fi
      if [[ -n "$repo" ]]; then
        gh issue comment "$PLAN_ISSUE_NUMBER" \
          --repo "$repo" \
          --body "Ralph completed this task and is preparing to merge." >/dev/null 2>&1 || true
      fi
    fi
  fi
}

# --- Detect plan: find in-progress work or pick from backlog ---
# Sets: WIP_FILES, FILE_REFS, RESUMING
detect_plan() {
  WIP_FILES=()
  FILE_REFS=""
  RESUMING=false

  # Check for in-progress plan files
  local wip_plans=()
  for f in "$WIP_DIR"/*.md; do
    [[ -f "$f" ]] && wip_plans+=("$f")
  done

  if [[ ${#wip_plans[@]} -gt 0 ]]; then
    # Resume in-progress work
    RESUMING=true
    WIP_FILES=("${wip_plans[@]}")
    for f in "${WIP_FILES[@]}"; do
      FILE_REFS="$FILE_REFS @$f"
    done
    echo "Found in-progress plan(s): ${WIP_FILES[*]}"
    return 0
  fi

  # Check backlog
  local backlog_plans=()
  for f in "$BACKLOG_DIR"/*.md; do
    [[ -f "$f" ]] && backlog_plans+=("$f")
  done

  if [[ ${#backlog_plans[@]} -eq 0 ]]; then
    if pull_github_issues; then
      # Re-scan backlog after pulling issue
      for f in "$BACKLOG_DIR"/*.md; do
        [[ -f "$f" ]] && backlog_plans+=("$f")
      done
      if [[ ${#backlog_plans[@]} -eq 0 ]]; then
        echo "Nothing to do — issue pull produced no plan file. Add plans to .ralph/backlog/ — see .ralph/PLAN-GUIDE.md"
        return 1
      fi
    else
      echo "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralph/backlog/ — see .ralph/PLAN-GUIDE.md"
      return 1
    fi
  fi

  # Filter backlog by dependency readiness and skip list
  local ready_plans=()
  local blocked_info=()
  for f in "${backlog_plans[@]}"; do
    local fb
    fb=$(basename "$f")
    # Skip plans that had branch/PR collisions this session
    if [[ -n "${SKIPPED_PLANS[$fb]+x}" ]]; then
      blocked_info+=("$fb => skipped (branch/PR already exists)")
      continue
    fi
    readiness=$(plan_readiness "$f")
    if [[ "$readiness" == "ready" ]]; then
      ready_plans+=("$f")
    else
      blocked_info+=("$fb => ${readiness#blocked:}")
    fi
  done

  if [[ ${#ready_plans[@]} -eq 0 ]]; then
    echo "Backlog has ${#backlog_plans[@]} plan(s), but none are runnable yet."
    echo ""
    for line in "${blocked_info[@]}"; do
      local plan_name="${line%% =>*}"
      local reason="${line#*=> }"
      if [[ "$reason" == "skipped (branch/PR already exists)" ]]; then
        echo "  $plan_name — skipped: branch or PR already exists"
      else
        # Parse dependency reasons like "pending:dep-a.md,missing:dep-b.md"
        echo "  $plan_name — waiting on dependencies:"
        IFS=',' read -ra dep_entries <<< "$reason"
        for entry in "${dep_entries[@]}"; do
          local dep_status="${entry%%:*}"
          local dep_name="${entry#*:}"
          case "$dep_status" in
            pending)  echo "    - $dep_name (still in backlog or in-progress)" ;;
            missing)  echo "    - $dep_name (not found — never created or misnamed?)" ;;
            self)     echo "    - $dep_name (depends on itself)" ;;
            *)        echo "    - $entry" ;;
          esac
        done
      fi
    done
    echo ""
    echo "Plans become runnable when their dependencies are archived in $ARCHIVE_DIR/."
    return 1
  fi

  # Pick a plan from dependency-ready backlog plans
  local chosen=""
  if [[ ${#ready_plans[@]} -eq 1 ]]; then
    chosen="${ready_plans[0]}"
    echo "Single dependency-ready backlog plan found: $chosen"
  else
    echo "Multiple dependency-ready backlog plans found (${#ready_plans[@]}). Asking LLM to pick the best one..."

    # Build @file references for all dependency-ready backlog plans
    local backlog_refs=""
    for f in "${ready_plans[@]}"; do
      backlog_refs="$backlog_refs @$f"
    done

    local selection_prompt="${backlog_refs}
Read these backlog plans carefully. Choose the single best plan to work on next.
Consider:
- Dependencies: does this plan unblock other plans in the backlog?
- Risk: should risky architectural work go before safe incremental work?
- Value: which delivers the most user-facing impact?
- Simplicity: if plans are similar in value, prefer the simpler one.

Output ONLY the basename of the chosen file (e.g. prd-foo-bar.md), nothing else."

    local llm_output
    llm_output=$($AGENT_COMMAND "$selection_prompt" 2>/dev/null) || {
      echo "ERROR: LLM selection failed. Falling back to oldest backlog plan."
      chosen="${ready_plans[0]}"
    }

    if [[ -z "$chosen" ]]; then
      # Extract filename from LLM output — strip whitespace, backticks, quotes
      local picked
      picked=$(echo "$llm_output" | grep -oP '[a-zA-Z0-9_-]+\.md' | tail -1)

      if [[ -n "$picked" ]]; then
        local matched_ready=""
        for rp in "${ready_plans[@]}"; do
          if [[ "$(basename "$rp")" == "$picked" ]]; then
            matched_ready="$rp"
            break
          fi
        done

        if [[ -n "$matched_ready" ]]; then
          chosen="$matched_ready"
          echo "LLM selected: $picked"
        else
          echo "WARNING: LLM output didn't match a dependency-ready backlog file (got: '$picked'). Falling back to oldest ready plan."
          chosen="${ready_plans[0]}"
        fi
      else
        echo "WARNING: Could not parse LLM selection. Falling back to oldest ready plan."
        chosen="${ready_plans[0]}"
      fi
    fi
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] Would select: $chosen"
    local chosen_base
    chosen_base=$(basename "$chosen")
    WIP_FILES=("$chosen")
    FILE_REFS=" @$chosen"
    RESUMING=false
    echo "[dry-run] Would move: $chosen -> $WIP_DIR/$chosen_base"
  else
    # Move chosen plan to in-progress
    mkdir -p "$WIP_DIR"
    local dest_basename
    dest_basename=$(basename "$chosen")
    local dest="$WIP_DIR/$dest_basename"
    mv "$chosen" "$dest"
    echo "Moved $chosen -> $dest"

    WIP_FILES=("$dest")
    FILE_REFS=" @$dest"
    RESUMING=false
  fi
  return 0
}

# --- Merge and cleanup after completion ---
merge_and_cleanup() {
  local branch="$1"
  local plan_desc="$2"

  # Check if merge target is protected
  if is_branch_protected "$MERGE_TARGET"; then
    echo ""
    echo "Merge target '$MERGE_TARGET' is protected. Attempting to create PR..."

    # Check if gh CLI is available
    if ! command -v gh &>/dev/null; then
      echo "WARNING: 'gh' CLI not found. Cannot create PR automatically."
      echo "Install gh (https://cli.github.com) to enable auto-PR for protected branches."
      echo ""
      echo "Branch '$branch' left intact for manual merge/PR."
      echo "To merge manually: git checkout $MERGE_TARGET && git merge $branch --no-ff"
      return 0
    fi

    # Push branch to remote
    echo "Pushing $branch to origin..."
    if ! git push -u origin "$branch" 2>&1; then
      echo "WARNING: Failed to push branch. Branch left intact for manual push/PR."
      return 0
    fi

    # Build PR body from plan content and commit log
    local pr_body=""
    local plan_content=""
    for f in "${WIP_FILES[@]}"; do
      if [[ -f "$f" ]]; then
        plan_content=$(cat "$f")
        break
      fi
    done
    # If plan was already archived, check out/ for the timestamped copy
    if [[ -z "$plan_content" ]]; then
      local latest_archived
      latest_archived=$(ls -t "$ARCHIVE_DIR"/*.md 2>/dev/null | head -1)
      if [[ -n "$latest_archived" ]]; then
        plan_content=$(cat "$latest_archived")
      fi
    fi

    local commit_log
    commit_log=$(git log "$MERGE_TARGET".."$branch" --oneline --no-decorate 2>/dev/null || true)

    pr_body="## Plan

${plan_content:-_No plan content available._}

## Commits

\`\`\`
${commit_log:-_No commits._}
\`\`\`"

    echo "Creating PR: $branch -> $MERGE_TARGET"
    local pr_url
    pr_url=$(gh pr create \
      --base "$MERGE_TARGET" \
      --head "$branch" \
      --title "$plan_desc" \
      --body "$pr_body" 2>&1) || {
      echo "WARNING: Failed to create PR: $pr_url"
      echo "Branch '$branch' pushed to origin. Create PR manually."
      return 0
    }

    echo ""
    echo "PR created: $pr_url"

    # Comment on linked issue about the PR (but don't close — PR still needs review)
    if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" && "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
      local repo
      repo=$(detect_issue_repo) && \
      gh issue comment "$PLAN_ISSUE_NUMBER" \
        --repo "$repo" \
        --body "Ralph created a PR for this issue: ${pr_url}" >/dev/null 2>&1
    fi

    return 0
  fi

  echo "Merging $branch into $MERGE_TARGET..."
  git checkout "$MERGE_TARGET"
  git merge "$branch" --no-ff -m "Merge $branch: $plan_desc"
  git branch -d "$branch"
  echo "Merged to $MERGE_TARGET. Branch $branch deleted."

  # Close linked GitHub issue after successful merge
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" && "$ISSUE_CLOSE_ON_COMPLETE" == "true" ]]; then
    local repo
    repo=$(detect_issue_repo) && {
      gh issue close "$PLAN_ISSUE_NUMBER" \
        --repo "$repo" \
        --comment "Completed by Ralph on branch \`${branch}\`. Merged to \`${MERGE_TARGET}\`." >/dev/null 2>&1
      # Remove in-progress label (issue is now closed)
      gh issue edit "$PLAN_ISSUE_NUMBER" \
        --repo "$repo" \
        --remove-label "$ISSUE_IN_PROGRESS_LABEL" >/dev/null 2>&1
    }
  fi
}

# --- Extract plan description from first heading ---
plan_description() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # Get the first markdown heading, strip the # prefix
    sed -n 's/^#\+ *//p' "$file" | head -1
  else
    echo "ralph task"
  fi
}

# ==========================================================================
# MAIN LOOP — pick a plan, run iterations, merge on complete, repeat
# ==========================================================================

plans_completed=0

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "========================================"
  echo "  Ralph dry-run — preview only"
  echo "========================================"

  if ! detect_plan; then
    echo "[dry-run] No runnable work found."
    exit 0
  fi

  PLAN_DESC=$(plan_description "${WIP_FILES[0]}")
  echo "[dry-run] Plan: $(basename "${WIP_FILES[0]}")"
  echo "[dry-run] Description: $PLAN_DESC"

  if [[ "$RESUMING" == true ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    echo "[dry-run] Mode: resume in-progress"
    echo "[dry-run] Would run on current branch: $current_branch"
    echo "[dry-run] Would keep existing $PROGRESS_FILE"
  else
    plan_basename=$(basename "${WIP_FILES[0]}")
    slug="${plan_basename#prd-}"
    slug="${slug%.md}"
    branch="ralph/${slug}"
    if git show-ref --verify --quiet "refs/heads/ralph"; then
      echo "[dry-run] WARNING: Branch 'ralph' exists and would block creation of '$branch'."
      echo "[dry-run] Fix: git branch -m ralph ralph-legacy  OR  git branch -D ralph"
    fi
    if branch_has_open_work "$branch"; then
      echo "[dry-run] WARNING: $COLLISION_REASON"
      echo "[dry-run] This plan would be SKIPPED in a real run."
    fi
    echo "[dry-run] Mode: pick from backlog"
    echo "[dry-run] Would create branch from $BASE_BRANCH: $branch"
    echo "[dry-run] Would initialize: $PROGRESS_FILE"
  fi

  echo "[dry-run] Merge target: $MERGE_TARGET"
  if is_branch_protected "$MERGE_TARGET"; then
    echo "[dry-run] Merge target is PROTECTED — would create PR via 'gh' on completion"
  else
    echo "[dry-run] Merge target is not protected — would merge directly on completion"
  fi
  if [[ -n "$PROTECTED_BRANCHES" ]]; then
    echo "[dry-run] Protected branches: $PROTECTED_BRANCHES"
  fi

  echo "[dry-run] No files moved, no branches created, no agent run executed."
  exit 0
fi

while true; do
  echo ""
  echo "========================================"
  echo "  Ralph — detecting next task..."
  echo "========================================"

  if ! detect_plan; then
    if [[ $plans_completed -gt 0 ]]; then
      echo ""
      echo "All done. Completed $plans_completed plan(s) this session."
    fi
    exit 0
  fi

  # Get a description for merge commit messages
  PLAN_DESC=$(plan_description "${WIP_FILES[0]}")

  # --- Branch strategy ---
  if [[ "$RESUMING" == true ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == "$BASE_BRANCH" ]]; then
      echo "ERROR: Resuming requires being on a ralph/* branch, not '$BASE_BRANCH'."
      echo "Checkout the branch you want to resume, then run again."
      exit 1
    fi
    branch="$current_branch"
    echo "Resuming on existing branch: $branch"

    # Preserve existing progress file
    echo "Resuming — keeping existing $PROGRESS_FILE"
  else
    git checkout "$BASE_BRANCH"
    # Derive branch slug from plan file name (e.g. prd-add-dark-mode.md → add-dark-mode)
    plan_basename=$(basename "${WIP_FILES[0]}")
    slug="${plan_basename#prd-}"
    slug="${slug%.md}"
    branch="ralph/${slug}"

    # Guard: a bare "ralph" branch blocks all "ralph/*" branches (git ref hierarchy conflict)
    if git show-ref --verify --quiet "refs/heads/ralph"; then
      echo ""
      echo "ERROR: Branch 'ralph' exists and blocks creation of '$branch'."
      echo "Git cannot create 'ralph/<slug>' when a branch named 'ralph' already exists."
      echo ""
      echo "Fix: delete or rename the stale branch, then retry:"
      echo "  git branch -m ralph ralph-legacy   # rename"
      echo "  git branch -D ralph                # or delete"
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo ""
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi

    # Safety: check for existing branch/PR collision
    if branch_has_open_work "$branch"; then
      echo ""
      echo "SKIP: $COLLISION_REASON"
      echo "Plan '$plan_basename' already has open work. Skipping to next plan."
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      SKIPPED_PLANS["$plan_basename"]=1
      continue
    fi
    if ! git checkout -b "$branch"; then
      echo ""
      echo "ERROR: Failed to create branch '$branch'."
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi
    echo "Created branch from $BASE_BRANCH: $branch"

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  fi

  # --- Iteration loop (per-plan) ---
  stuck_count=0
  last_hash=$(git rev-parse HEAD)
  completed=false

  i=0
  while [[ "$ITERATIONS" -eq 0 ]] || [[ "$i" -lt "$ITERATIONS" ]]; do
    i=$((i + 1))
    echo ""
    if [[ "$ITERATIONS" -eq 0 ]]; then
      echo "=== Ralph iteration $i (unlimited) (plan: $(basename "${WIP_FILES[0]}")) ==="
    else
      echo "=== Ralph iteration $i of $ITERATIONS (plan: $(basename "${WIP_FILES[0]}")) ==="
    fi

    PROMPT="${FILE_REFS} @${PROGRESS_FILE}${LEARNINGS_REF}
1. Read the referenced files and the progress file.${LEARNINGS_HINT}
2. Find the highest-priority incomplete task (see prioritization rules in the plan).
3. Implement it with small, focused changes. Testing strategy depends on task type:
   - Bug fix: Write a failing test FIRST that reproduces the bug, then fix the code to make it pass.
   - New feature: Implement the feature, then add tests that cover the new code.
   - Refactor: Verify existing tests pass before and after. Only add tests if you discover coverage gaps.
4. $(if [[ -n "$FEEDBACK_COMMANDS_TEXT" ]]; then echo "Run all feedback loops: ${FEEDBACK_COMMANDS_TEXT}. Fix any failures before continuing."; else echo "Run your project's build, test, and lint commands. Fix any failures before continuing."; fi)
5. Documentation: Review whether your changes affect any documentation. Update these files if they are outdated or incomplete:
   - README.md (commands, usage, feature descriptions)
   - AGENTS.md — only if your work created knowledge that future coding agents need and cannot easily infer from the code (e.g. new CLI commands, non-obvious architectural constraints, changed dev workflows). Routine bug fixes, internal refactors, and new tests do not warrant an AGENTS.md update.
  - LEARNINGS.md docs: preserve the two-tier model (.ralph/LEARNINGS.md for Ralph logs, repo-level LEARNINGS.md for maintainer-curated durable guidance).
  - Project documentation files that describe architecture, conventions, agent instructions, or reusable skills — update only if your changes affect them.
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.${LEARNINGS_STEP}
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "7"; else echo "6"; fi). Update ${PROGRESS_FILE} with what you did, decisions made, files changed, and any blockers.
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "8"; else echo "7"; fi). Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish an iteration with uncommitted changes.
ONLY WORK ON A SINGLE TASK.
If all tasks are complete, output <promise>COMPLETE</promise> — but ONLY after committing. Never output COMPLETE with uncommitted changes."

    agent_output_file=$(mktemp)
    set +e
    if [[ "$ITERATION_TIMEOUT" -gt 0 ]]; then
      timeout "$ITERATION_TIMEOUT" $AGENT_COMMAND "$PROMPT" 2>&1 | tee "$agent_output_file"
      agent_exit=${PIPESTATUS[0]}
      if [[ $agent_exit -eq 124 ]]; then
        echo ""
        echo "WARNING: Agent command timed out after ${ITERATION_TIMEOUT}s."
      fi
    else
      $AGENT_COMMAND "$PROMPT" 2>&1 | tee "$agent_output_file"
      agent_exit=${PIPESTATUS[0]}
    fi
    set -e
    result=$(<"$agent_output_file")
    rm -f "$agent_output_file"

    if [[ $agent_exit -ne 0 && $agent_exit -ne 124 ]]; then
      echo ""
      echo "WARNING: Agent command exited with status $agent_exit."
    fi

    # --- Stuck detection (BEFORE auto-commit to avoid false progress) ---
    current_hash=$(git rev-parse HEAD)
    if [[ "$current_hash" == "$last_hash" ]]; then
      stuck_count=$((stuck_count + 1))
      echo "WARNING: No new commits this iteration ($stuck_count/$MAX_STUCK)."
      if [[ $stuck_count -ge $MAX_STUCK ]]; then
        echo "ERROR: $MAX_STUCK consecutive iterations with no progress. Aborting."
        echo "Branch: $branch"
        echo "Plan files remain in $WIP_DIR/ — resume with another run."
        exit 1
      fi
    else
      stuck_count=0
      last_hash="$current_hash"
    fi

    # --- Auto-commit dirty state (AFTER stuck detection) ---
    if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      echo "WARNING: Agent left uncommitted changes. Auto-committing recovery snapshot."
      git add -A
      git commit -m "chore(ralph): auto-commit uncommitted changes from iteration $i" || true
    fi

    # --- Check for completion ---
    if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
      echo ""
      echo "Plan complete after $i iterations: $PLAN_DESC"
      archive_run
      merge_and_cleanup "$branch" "$PLAN_DESC"
      plans_completed=$((plans_completed + 1))
      completed=true
      break
    fi
  done

  if [[ "$completed" == false ]]; then
    echo ""
    echo "Finished $ITERATIONS iterations without completing: $PLAN_DESC"
    echo "Plan files remain in $WIP_DIR/ — resume with another run."
    echo "Branch: $branch"
    exit 0
  fi

  # Loop back to pick the next plan (iteration budget resets)
done

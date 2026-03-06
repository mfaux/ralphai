# --- lib/git.sh — Git helpers: dirty state, branch collision, preflight ---
# Sourced by ralphai.sh. Do not execute directly.

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

# --- PR mode preflight: validate gh CLI ---
# In PR mode, ralphai needs 'gh' to push branches and create PRs.
# Check early so the user finds out before the agent runs 10 turns.
if [[ "$MODE" == "pr" && "$DRY_RUN" != true ]]; then
  if ! command -v gh &>/dev/null; then
    echo "ERROR: PR mode requires the GitHub CLI (gh)."
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

# --- Safety: handle dirty git state (normal mode only) ---
if [[ "$DRY_RUN" != true ]]; then
  if is_tree_dirty; then
    if [[ "$RESUME" == true ]]; then
      current_branch=$(git rev-parse --abbrev-ref HEAD)
      if [[ "$current_branch" == "$BASE_BRANCH" ]]; then
        echo "ERROR: --resume refused on '$current_branch' branch (base branch)."
        echo "Switch to your ralphai/* branch first, then re-run with --resume."
        exit 1
      fi

      echo "Detected dirty state on $current_branch. Auto-committing recovery snapshot (--resume)."
      git add -A
      git commit -m "chore(ralphai): recover interrupted turn

Interrupted mid-turn on branch $current_branch.
Committing dirty state so ralphai.sh can resume." || true
    else
      echo "ERROR: Working tree is dirty. Commit or stash changes before running Ralphai."
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

# --- lib/git.sh — Git helpers: dirty state, branch collision, preflight ---
# Sourced by ralphai.sh. Do not execute directly.

is_tree_dirty() {
  # Exclude .ralphai — the worktree setup creates a symlink there that may
  # appear as an untracked file when the worktree is based on a commit whose
  # .gitignore only ignores ".ralphai/" (trailing-slash matches directories,
  # not symlinks).
  # The untracked-files check (ls-files) also excludes ralphai.json because
  # the worktree command symlinks it from the main repo when it isn't
  # committed, and the worktree's .gitignore may not list it yet.
  # We intentionally keep ralphai.json in the diff checks so that
  # modifications to a *committed* ralphai.json are still caught.
  if ! git diff --quiet HEAD -- ':!.ralphai' 2>/dev/null; then
    return 0
  fi
  if ! git diff --cached --quiet -- ':!.ralphai' 2>/dev/null; then
    return 0
  fi
  if [[ -n "$(git ls-files --others --exclude-standard -- ':!.ralphai' ':!ralphai.json')" ]]; then
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
    echo "Or use --branch to create a branch without pushing or creating a PR."
    exit 1
  fi
  if ! gh auth status &>/dev/null; then
    echo "ERROR: gh is installed but not authenticated."
    echo "Run 'gh auth login' first, or use --branch to skip PR creation."
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

      if [[ "$AUTO_COMMIT" == "false" && "$MODE" == "patch" ]]; then
        echo "WARNING: Dirty state detected on $current_branch (autoCommit=false, skipping recovery commit)."
        echo "Continuing with dirty working tree."
      else
        echo "Detected dirty state on $current_branch. Auto-committing recovery snapshot (--resume)."
        git add -A
        git commit -m "chore(ralphai): recover interrupted turn

Interrupted mid-turn on branch $current_branch.
Committing dirty state so ralphai can resume." || true
      fi
    else
      if [[ "$ALLOW_DIRTY" == true ]]; then
        echo "WARNING: Working tree is dirty. Proceeding anyway (--allow-dirty)."
      else
        echo "ERROR: Working tree is dirty. Commit or stash changes before running Ralphai."
        echo "Tip: re-run with --resume to auto-commit and continue, or --allow-dirty to skip this check."
        exit 1
      fi
    fi
  fi
fi

# --- Verify base branch exists ---
if ! git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then
  echo "ERROR: Base branch '$BASE_BRANCH' not found."
  exit 1
fi

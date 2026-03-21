# receipt.sh — Run receipt: metadata about the current run.
# Sourced by ralphai.sh — do not execute directly.
#
# The receipt file tracks which plan is running, where it started (main repo
# or worktree), how many turns have completed, and how many tasks have been
# completed. It is used to prevent cross-source conflicts (e.g. a worktree
# plan being resumed by `ralphai run` in the main repo) and to provide
# status information.
#
# Receipt files live at: .ralphai/pipeline/in-progress/<slug>/receipt.txt
# Format: key=value (one per line, no quoting needed).
#
# All read/write operations delegate to the TypeScript receipt module via
# the compiled receipt-cli.mjs. Only resolve_receipt_path() remains in bash
# because it sets shell variables consumed by the orchestrator.

# Fallback: compute _RECEIPT_CLI from this file's location if not already set
# (e.g. when sourced directly in tests without defaults.sh).
if [[ -z "${_RECEIPT_CLI:-}" ]]; then
  _RECEIPT_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/dist/receipt-cli.mjs"
fi

# --- Derive the receipt file path from the plan slug ---
# Must be called after WIP_FILES is set (i.e. after detect_plan).
# Sets: RECEIPT_FILE, PLAN_SLUG, PLAN_BASENAME, PROGRESS_FILE
resolve_receipt_path() {
  local plan_basename
  plan_basename=$(basename "${WIP_FILES[0]}")
  PLAN_BASENAME="$plan_basename"
  local plan_dir
  plan_dir=$(dirname "${WIP_FILES[0]}")
  PLAN_SLUG=$(basename "$plan_dir")
  RECEIPT_FILE="$plan_dir/receipt.txt"
  PROGRESS_FILE="$plan_dir/progress.md"
}

# --- Write a new receipt file ---
# Called at the start of a new run (not on resume).
init_receipt() {
  local source="main"
  local worktree_path=""
  if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
    source="worktree"
    worktree_path="$(pwd)"
  fi

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  local wt_arg=""
  if [[ -n "$worktree_path" ]]; then
    wt_arg="$worktree_path"
  fi

  node "$_RECEIPT_CLI" init \
    "$RECEIPT_FILE" "$source" "$branch" "$PLAN_SLUG" "$PLAN_BASENAME" "${TURNS:-5}" $wt_arg

  echo "Initialized $RECEIPT_FILE"
}

# --- Increment the turns_completed counter ---
# Called after each turn completes (after auto-commit).
update_receipt_turn() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi
  node "$_RECEIPT_CLI" update-turn "$RECEIPT_FILE"
}

# --- Recount tasks_completed from progress.md ---
# Called after each turn completes (after auto-commit).
update_receipt_tasks() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi
  if [[ ! -f "$PROGRESS_FILE" ]]; then
    return
  fi
  node "$_RECEIPT_CLI" update-tasks "$RECEIPT_FILE" "$PROGRESS_FILE"
}

# --- Check receipt source for cross-source conflicts ---
# Called after detect_plan, before branch strategy. Hard exits on conflict.
check_receipt_source() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi

  # The TS check-source scans all in-progress receipts and prints
  # conflict details to stderr, exiting 1 on conflict.
  # We need to pass the .ralphai directory (parent of pipeline/).
  local ralphai_dir
  ralphai_dir=$(dirname "$(dirname "$(dirname "$RECEIPT_FILE")")")
  if ! node "$_RECEIPT_CLI" check-source "$ralphai_dir" "$RALPHAI_IS_WORKTREE"; then
    exit 1
  fi
}

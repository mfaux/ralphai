# receipt.sh — Run receipt: metadata about the current run.
# Sourced by ralphai.sh — do not execute directly.
#
# The receipt file tracks which plan is running, where it started (main repo
# or worktree), how many turns have completed, and how many tasks have been
# completed. It is used to prevent cross-source conflicts (e.g. a worktree
# plan being resumed by `ralphai run` in the main repo) and to provide
# status information.
#
# Receipt files live at: .ralphai/pipeline/in-progress/receipt-<slug>.txt
# Format: key=value (one per line, no quoting needed).
#
# Fields:
#   started_at       — ISO 8601 UTC timestamp of when the run started
#   source           — "main" or "worktree"
#   worktree_path    — absolute path to worktree (only when source=worktree)
#   branch           — git branch name
#   slug             — plan slug (derived from filename)
#   agent            — agent command string
#   turns_completed  — number of agent turns completed
#   tasks_completed  — number of plan tasks completed (parsed from progress.md)

# --- Derive the receipt file path from the plan slug ---
# Must be called after WIP_FILES is set (i.e. after detect_plan).
# Sets: RECEIPT_FILE, PLAN_SLUG
resolve_receipt_path() {
  local plan_basename
  plan_basename=$(basename "${WIP_FILES[0]}")
  PLAN_SLUG="${plan_basename#prd-}"
  PLAN_SLUG="${PLAN_SLUG%.md}"
  RECEIPT_FILE="$WIP_DIR/receipt-${PLAN_SLUG}.txt"
  PROGRESS_FILE="$WIP_DIR/progress-${PLAN_SLUG}.md"

  # Backward-compat: migrate legacy progress.md → progress-<slug>.md
  # when there is exactly one plan in-progress and the old file exists.
  if [[ ! -f "$PROGRESS_FILE" && -f "$WIP_DIR/progress.md" ]]; then
    mv "$WIP_DIR/progress.md" "$PROGRESS_FILE"
    echo "Migrated progress.md -> $(basename "$PROGRESS_FILE")"
  fi
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

  {
    echo "started_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "source=$source"
    if [[ -n "$worktree_path" ]]; then
      echo "worktree_path=$worktree_path"
    fi
    echo "branch=$branch"
    echo "slug=$PLAN_SLUG"
    echo "agent=$AGENT_COMMAND"
    echo "turns_completed=0"
    echo "tasks_completed=0"
  } > "$RECEIPT_FILE"

  echo "Initialized $RECEIPT_FILE"
}

# --- Increment the turns_completed counter ---
# Called after each turn completes (after auto-commit).
update_receipt_turn() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi

  local current
  current=$(sed -n 's/^turns_completed=//p' "$RECEIPT_FILE")
  current=${current:-0}
  local next=$((current + 1))
  sed -i "s/^turns_completed=.*/turns_completed=$next/" "$RECEIPT_FILE"
}

# --- Recount tasks_completed from progress.md ---
# Called after each turn completes (after auto-commit).
# Counts individual `**Status:** Complete` markers and batch `Tasks X-Y` headings
# in $PROGRESS_FILE, then writes the total to the receipt.
update_receipt_tasks() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi
  if [[ ! -f "$PROGRESS_FILE" ]]; then
    return
  fi

  local count=0

  # Count individual **Status:** Complete markers (case-insensitive)
  local individual
  individual=$(grep -ci '\*\*Status:\*\*[[:space:]]*Complete' "$PROGRESS_FILE" 2>/dev/null || true)
  count=$((count + individual))

  # Count batch entries: Tasks X-Y or Tasks X–Y (en-dash or hyphen)
  # Each match contributes (end - start + 1) tasks
  while IFS= read -r line; do
    # Extract start and end numbers from patterns like "Tasks 1-3" or "Tasks 1–3"
    local start_num end_num
    start_num=$(echo "$line" | sed -n 's/.*[Tt]asks\?[[:space:]]\+\([0-9]\+\)[[:space:]]*[–-][[:space:]]*\([0-9]\+\).*/\1/p')
    end_num=$(echo "$line" | sed -n 's/.*[Tt]asks\?[[:space:]]\+\([0-9]\+\)[[:space:]]*[–-][[:space:]]*\([0-9]\+\).*/\2/p')
    if [[ -n "$start_num" && -n "$end_num" && "$end_num" -gt "$start_num" ]]; then
      count=$((count + end_num - start_num + 1))
    fi
  done < <(grep -i 'tasks\?[[:space:]]\+[0-9]\+[[:space:]]*[–-][[:space:]]*[0-9]\+' "$PROGRESS_FILE" 2>/dev/null || true)

  # Update or append tasks_completed in the receipt
  if grep -q '^tasks_completed=' "$RECEIPT_FILE"; then
    sed -i "s/^tasks_completed=.*/tasks_completed=$count/" "$RECEIPT_FILE"
  else
    echo "tasks_completed=$count" >> "$RECEIPT_FILE"
  fi
}

# --- Check receipt source for cross-source conflicts ---
# Called after detect_plan, before branch strategy. Hard exits on conflict.
check_receipt_source() {
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    return
  fi

  local receipt_source
  receipt_source=$(sed -n 's/^source=//p' "$RECEIPT_FILE")

  if [[ "$receipt_source" == "worktree" && "$RALPHAI_IS_WORKTREE" != true ]]; then
    local wt_path
    wt_path=$(sed -n 's/^worktree_path=//p' "$RECEIPT_FILE")
    local wt_branch
    wt_branch=$(sed -n 's/^branch=//p' "$RECEIPT_FILE")
    local wt_started
    wt_started=$(sed -n 's/^started_at=//p' "$RECEIPT_FILE")
    echo ""
    echo "ERROR: Plan \"$PLAN_SLUG\" is running in a worktree."
    echo ""
    echo "  Worktree: ${wt_path:-unknown}"
    echo "  Branch:   ${wt_branch:-unknown}"
    echo "  Started:  ${wt_started:-unknown}"
    echo ""
    echo "  To resume:  ralphai worktree"
    echo "  To discard: ralphai worktree clean"
    exit 1
  fi

  if [[ "$receipt_source" == "main" && "$RALPHAI_IS_WORKTREE" == true ]]; then
    local main_branch
    main_branch=$(sed -n 's/^branch=//p' "$RECEIPT_FILE")
    local main_started
    main_started=$(sed -n 's/^started_at=//p' "$RECEIPT_FILE")
    echo ""
    echo "ERROR: Plan \"$PLAN_SLUG\" is already running in the main repository."
    echo ""
    echo "  Branch:  ${main_branch:-unknown}"
    echo "  Started: ${main_started:-unknown}"
    echo ""
    echo "  Finish or interrupt the main-repo run first, then retry."
    exit 1
  fi
}

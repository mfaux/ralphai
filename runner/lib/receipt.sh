# receipt.sh — Run receipt: metadata about the current run.
# Sourced by ralphai.sh — do not execute directly.
#
# The receipt file tracks which plan is running, where it started (main repo
# or worktree), and how many turns have completed. It is used to prevent
# cross-source conflicts (e.g. a worktree plan being resumed by `ralphai run`
# in the main repo) and to provide status information.
#
# Receipt files live at: .ralphai/pipeline/in-progress/receipt-<slug>.txt
# Format: key=value (one per line, no quoting needed).

# --- Derive the receipt file path from the plan slug ---
# Must be called after WIP_FILES is set (i.e. after detect_plan).
# Sets: RECEIPT_FILE, PLAN_SLUG
resolve_receipt_path() {
  local plan_basename
  plan_basename=$(basename "${WIP_FILES[0]}")
  PLAN_SLUG="${plan_basename#prd-}"
  PLAN_SLUG="${PLAN_SLUG%.md}"
  RECEIPT_FILE="$WIP_DIR/receipt-${PLAN_SLUG}.txt"
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

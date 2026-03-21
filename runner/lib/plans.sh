# plans.sh — Plan dependency helpers and plan detection
# Sourced by ralphai.sh — do not execute directly.
#
# Core plan logic lives in src/plan-detection.ts. This file provides thin
# shell wrappers that call the compiled CLI and set shell globals
# (WIP_FILES, FILE_REFS, RESUMING) expected by ralphai.sh.

# --- CLI path fallback (for tests that source this file directly) ---
if [[ -z "${_PLAN_DETECTION_CLI:-}" || ! -f "${_PLAN_DETECTION_CLI:-}" ]]; then
  _PLAN_DETECTION_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/dist/plan-detection-cli.mjs"
fi

# --- Scope extraction (optional frontmatter: scope) ---
extract_scope() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  node "$_FRONTMATTER_CLI" scope "$file"
}

# --- Plan dependency helpers (optional frontmatter: depends-on) ---
extract_depends_on() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  node "$_FRONTMATTER_CLI" depends-on "$file"
}

# Return dependency status for a plan basename:
#   done    -> archived in out/
#   pending -> present in backlog/ or in-progress/
#   missing -> not found anywhere known
dependency_status() {
  local dep_base
  dep_base=$(basename "$1")
  node "$_PLAN_DETECTION_CLI" dep-status "$dep_base" "$WIP_DIR" "$BACKLOG_DIR" "$ARCHIVE_DIR"
}

# Determine whether a backlog plan is ready based on depends-on metadata.
# Prints "ready" when runnable, otherwise "blocked:<reasons>".
plan_readiness() {
  local plan="$1"
  node "$_PLAN_DETECTION_CLI" readiness "$plan" "$WIP_DIR" "$BACKLOG_DIR" "$ARCHIVE_DIR"
}

# --- Resolve plan file path inside a slug-folder (in-progress/out only) ---
plan_file_for_dir() {
  local dir="$1"
  local slug
  slug=$(basename "$dir")
  local candidate="$dir/${slug}.md"
  if [[ -f "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  return 1
}

# --- Collect backlog plans (flat .md files only) ---
# Populates the named array with plan file paths.
collect_backlog_plans() {
  local -n _out_plans=$1
  _out_plans=()

  while IFS= read -r line; do
    [[ -n "$line" ]] && _out_plans+=("$line")
  done < <(node "$_PLAN_DETECTION_CLI" backlog "$BACKLOG_DIR")
}

# --- Detect plan: find in-progress work or pick from backlog ---
# Sets: WIP_FILES, FILE_REFS, RESUMING
#
# Delegates core detection to the TypeScript plan-detection-cli.
# Shell-specific orchestration (pull_github_issues on empty backlog,
# SKIPPED_PLANS handling, verbose diagnostic output, setting globals)
# is handled here.
detect_plan() {
  WIP_FILES=()
  FILE_REFS=""
  RESUMING=false

  # Build CLI arguments
  local detect_args=("$WIP_DIR" "$BACKLOG_DIR" "$ARCHIVE_DIR")

  if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
    local _branch
    _branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    detect_args+=("--worktree-branch=$_branch")
  fi

  if [[ "$DRY_RUN" == true ]]; then
    detect_args+=("--dry-run")
  fi

  # Convert SKIPPED_PLANS associative array to --skip-slug args
  for key in "${!SKIPPED_PLANS[@]}"; do
    # Shell keys are basenames with .md; TS expects slugs without .md
    local skip_slug="${key%.md}"
    detect_args+=("--skip-slug=$skip_slug")
  done

  # Call TypeScript plan detection
  local detect_json
  detect_json=$(node "$_PLAN_DETECTION_CLI" detect "${detect_args[@]}" 2>/dev/null) || true

  if [[ -z "$detect_json" ]]; then
    echo "Nothing to do — plan detection failed."
    return 1
  fi

  # Parse JSON result
  local detected reason
  detected=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.detected))")

  if [[ "$detected" == "true" ]]; then
    # Plan found — extract fields
    local plan_file plan_slug wip_dir resumed
    plan_file=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.planFile)")
    plan_slug=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.planSlug)")
    wip_dir=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.wipDir)")
    resumed=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.plan.resumed))")

    WIP_FILES=("$plan_file")
    FILE_REFS=" $(format_file_ref "$plan_file")"

    if [[ "$resumed" == "true" ]]; then
      RESUMING=true
      echo "Found in-progress plan(s): ${WIP_FILES[*]}"
    else
      RESUMING=false
      if [[ "$DRY_RUN" == true ]]; then
        echo "[dry-run] Would select: $BACKLOG_DIR/${plan_slug}.md"
        echo "[dry-run] Would promote flat file: $BACKLOG_DIR/${plan_slug}.md -> $plan_file"
      else
        echo "Promoted flat file: $BACKLOG_DIR/${plan_slug}.md -> $plan_file"
      fi
    fi
    return 0
  fi

  # No plan detected — check reason
  reason=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.reason||'')")

  if [[ "$reason" == "empty-backlog" ]]; then
    # Backlog is empty — try pulling from GitHub issues
    if [[ "$DRY_RUN" == true ]]; then
      echo "[dry-run] Backlog is empty. Would attempt to pull a GitHub issue (if configured)."
      return 1
    fi
    if pull_github_issues; then
      # Re-run detection after pulling issue (backlog should now have a plan)
      detect_json=$(node "$_PLAN_DETECTION_CLI" detect "${detect_args[@]}" 2>/dev/null) || true
      detected=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.detected))" 2>/dev/null) || detected="false"

      if [[ "$detected" == "true" ]]; then
        local plan_file plan_slug wip_dir
        plan_file=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.planFile)")
        plan_slug=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.planSlug)")
        wip_dir=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.plan.wipDir)")

        WIP_FILES=("$plan_file")
        FILE_REFS=" $(format_file_ref "$plan_file")"
        RESUMING=false
        echo "Promoted flat file: $BACKLOG_DIR/${plan_slug}.md -> $plan_file"
        return 0
      else
        echo "Nothing to do — issue pull produced no plan file. Add plans to .ralphai/pipeline/backlog/<slug>.md — see .ralphai/PLANNING.md"
        return 1
      fi
    else
      echo "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralphai/pipeline/backlog/<slug>.md — see .ralphai/PLANNING.md"
      return 1
    fi
  fi

  # All plans blocked — print diagnostic info
  local backlog_count
  backlog_count=$(echo "$detect_json" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.backlogCount))")

  echo "Backlog has ${backlog_count} plan(s), but none are runnable yet."
  echo ""

  # Parse blocked array and print diagnostics
  node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    for (const b of d.blocked || []) {
      if (b.reason === 'skipped') {
        console.log('  ' + b.slug + '.md — skipped: branch or PR already exists');
      } else {
        console.log('  ' + b.slug + '.md — waiting on dependencies:');
        for (const entry of b.reason.split(',')) {
          const [status, dep] = [entry.split(':')[0], entry.split(':').slice(1).join(':')];
          if (status === 'pending') {
            console.log('    - ' + dep + ' (still in backlog or in-progress)');
          } else if (status === 'missing') {
            console.log('    - ' + dep + ' (not found — never created or misnamed?)');
          } else if (status === 'self') {
            console.log('    - ' + dep + ' (depends on itself)');
          } else {
            console.log('    - ' + entry);
          }
        }
      }
    }
  " <<< "$detect_json"

  echo ""
  echo "Plans become runnable when their dependencies are archived in $ARCHIVE_DIR/."
  return 1
}

# --- Extract plan description from first heading ---
plan_description() {
  local file="$1"
  if [[ -f "$file" ]]; then
    node "$_PLAN_DETECTION_CLI" describe "$file"
  else
    echo "ralphai task"
  fi
}

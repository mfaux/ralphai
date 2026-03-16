# plans.sh — Plan dependency helpers and plan detection
# Sourced by ralphai.sh — do not execute directly.

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
  local dep_slug
  dep_slug="${dep_base%.md}"

  if [[ -d "$ARCHIVE_DIR/$dep_slug" ]]; then
    echo "done"
    return 0
  fi

  if [[ -d "$WIP_DIR/$dep_slug" || -f "$BACKLOG_DIR/$dep_base" ]]; then
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
# Backlog only supports flat files: <backlog>/<slug>.md
collect_backlog_plans() {
  local -n _out_plans=$1
  _out_plans=()

  for f in "$BACKLOG_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    _out_plans+=("$f")
  done
}

# --- Detect plan: find in-progress work or pick from backlog ---
# Sets: WIP_FILES, FILE_REFS, RESUMING
detect_plan() {
  WIP_FILES=()
  FILE_REFS=""
  RESUMING=false

  # Check for in-progress plan files
  local in_progress_plans=()
  if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
    # In worktree mode, only consider the plan matching this branch.
    # Multiple worktrees share the same .ralphai/ directory via symlink,
    # so other worktrees' in-progress plans must be ignored.
    local _branch
    _branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    local _slug="${_branch#ralphai/}"
    local _dir="$WIP_DIR/$_slug"
    if [[ -d "$_dir" ]]; then
      local _plan_file
      _plan_file=$(plan_file_for_dir "$_dir") || _plan_file=""
      if [[ -n "$_plan_file" ]]; then
        in_progress_plans+=("$_plan_file")
      fi
    fi
  else
    for d in "$WIP_DIR"/*; do
      [[ -d "$d" ]] || continue
      local plan_file
      plan_file=$(plan_file_for_dir "$d") || continue
      in_progress_plans+=("$plan_file")
    done
  fi

  if [[ ${#in_progress_plans[@]} -gt 0 ]]; then
    # Resume in-progress work
    RESUMING=true
    WIP_FILES=("${in_progress_plans[@]}")
    for f in "${WIP_FILES[@]}"; do
      FILE_REFS="$FILE_REFS $(format_file_ref "$f")"
    done
    echo "Found in-progress plan(s): ${WIP_FILES[*]}"
    return 0
  fi

  # Check backlog
  local backlog_plans=()
  collect_backlog_plans backlog_plans

  if [[ ${#backlog_plans[@]} -eq 0 ]]; then
    if pull_github_issues; then
      # Re-scan backlog after pulling issue
      collect_backlog_plans backlog_plans
      if [[ ${#backlog_plans[@]} -eq 0 ]]; then
        echo "Nothing to do — issue pull produced no plan file. Add plans to .ralphai/pipeline/backlog/<slug>.md — see .ralphai/PLANNING.md"
        return 1
      fi
    else
      echo "Nothing to do — backlog is empty and no in-progress work. Add plans to .ralphai/pipeline/backlog/<slug>.md — see .ralphai/PLANNING.md"
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
    chosen="${ready_plans[0]}"
    echo "Multiple dependency-ready backlog plans found (${#ready_plans[@]}). Picking oldest: $(basename "$chosen")"
  fi

  # Backlog plans are always flat files: <backlog>/<slug>.md
  local slug
  slug="${chosen##*/}"  # basename
  slug="${slug%.md}"

  local dest_dir="$WIP_DIR/$slug"
  local dest_plan="$dest_dir/$slug.md"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] Would select: $chosen"
    WIP_FILES=("$dest_plan")
    FILE_REFS=" $(format_file_ref "$dest_plan")"
    RESUMING=false
    echo "[dry-run] Would promote flat file: $chosen -> $dest_plan"
  else
    # Move chosen plan to in-progress (promote flat file to slug-folder)
    mkdir -p "$WIP_DIR"
    mkdir -p "$dest_dir"
    mv "$chosen" "$dest_plan"
    echo "Promoted flat file: $chosen -> $dest_plan"

    WIP_FILES=("$dest_plan")
    FILE_REFS=" $(format_file_ref "$dest_plan")"
    RESUMING=false
  fi
  return 0
}

# --- Extract plan description from first heading ---
plan_description() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # Get the first markdown heading, strip the # prefix
    sed -n 's/^#\+ *//p' "$file" | head -1
  else
    echo "ralphai task"
  fi
}

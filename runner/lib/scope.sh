# scope.sh — Monorepo scope resolution and scoped feedback command derivation.
# Sourced by ralphai.sh after prompt.sh. Provides resolve_scoped_feedback().
# Depends on: PLAN_SCOPE, CONFIG_WORKSPACES, FEEDBACK_COMMANDS

# --- Detect the root package manager from lockfiles ---
# Prints: pnpm, yarn, npm, or bun. Falls back to npm if none detected.
_detect_pm_from_lockfiles() {
  if [[ -f "pnpm-lock.yaml" ]]; then
    echo "pnpm"
  elif [[ -f "yarn.lock" ]]; then
    echo "yarn"
  elif [[ -f "bun.lockb" || -f "bun.lock" ]]; then
    echo "bun"
  elif [[ -f "package-lock.json" ]]; then
    echo "npm"
  else
    echo "npm"
  fi
}

# --- Rewrite a single feedback command for a scoped package ---
# Usage: _rewrite_command <pm> <package_name> <command>
# Only rewrites commands that start with the detected package manager.
# Other commands (e.g. `make test`) pass through unchanged.
_rewrite_command() {
  local pm="$1" pkg_name="$2" cmd="$3"

  # Only rewrite if command starts with the package manager name
  if [[ "$cmd" != "$pm"* ]]; then
    echo "$cmd"
    return
  fi

  # Strip the pm prefix and optional "run" keyword to get the script name
  local rest="${cmd#"$pm"}"
  rest="${rest#" "}"
  # Handle "pm run <script>" pattern
  if [[ "$rest" == "run "* ]]; then
    rest="${rest#"run "}"
  fi

  case "$pm" in
    pnpm) echo "pnpm --filter $pkg_name $rest" ;;
    yarn) echo "yarn workspace $pkg_name $rest" ;;
    npm)  echo "npm -w $pkg_name run $rest" ;;
    bun)  echo "bun --filter $pkg_name $rest" ;;
    *)    echo "$cmd" ;;
  esac
}

# --- Resolve scoped feedback commands ---
# Called after config is loaded and PLAN_SCOPE is set.
# Modifies FEEDBACK_COMMANDS and rebuilds FEEDBACK_COMMANDS_TEXT.
resolve_scoped_feedback() {
  # No scope → nothing to do
  if [[ -z "$PLAN_SCOPE" ]]; then
    return 0
  fi

  # Check for workspace override first
  if [[ -n "$CONFIG_WORKSPACES" ]]; then
    local ws_fc
    ws_fc=$(echo "$CONFIG_WORKSPACES" | jq -r --arg scope "$PLAN_SCOPE" '
      if has($scope) and .[$scope].feedbackCommands then
        (.[$scope].feedbackCommands | if type == "array" then join(",") else . end)
      else empty end
    ' 2>/dev/null) || ws_fc=""

    if [[ -n "$ws_fc" ]]; then
      FEEDBACK_COMMANDS="$ws_fc"
      FEEDBACK_COMMANDS_TEXT=$(echo "$FEEDBACK_COMMANDS" | tr ',' ', ')
      return 0
    fi
  fi

  # No workspace override — derive scoped commands from package manager
  if [[ -z "$FEEDBACK_COMMANDS" ]]; then
    return 0
  fi

  # Read the package name from the scoped directory's package.json
  local pkg_json="$PLAN_SCOPE/package.json"
  if [[ ! -f "$pkg_json" ]]; then
    # No package.json in scope directory — can't derive scoped commands
    return 0
  fi

  local pkg_name
  pkg_name=$(jq -r '.name // empty' "$pkg_json" 2>/dev/null) || pkg_name=""
  if [[ -z "$pkg_name" ]]; then
    return 0
  fi

  local pm
  pm=$(_detect_pm_from_lockfiles)

  # Rewrite each feedback command
  local rewritten=()
  IFS=',' read -ra cmds <<< "$FEEDBACK_COMMANDS"
  for cmd in "${cmds[@]}"; do
    # Trim whitespace
    cmd="${cmd#"${cmd%%[![:space:]]*}"}"
    cmd="${cmd%"${cmd##*[![:space:]]}"}"
    rewritten+=("$(_rewrite_command "$pm" "$pkg_name" "$cmd")")
  done

  # Join with commas
  local joined=""
  for r in "${rewritten[@]}"; do
    if [[ -z "$joined" ]]; then
      joined="$r"
    else
      joined="$joined,$r"
    fi
  done

  FEEDBACK_COMMANDS="$joined"
  FEEDBACK_COMMANDS_TEXT=$(echo "$FEEDBACK_COMMANDS" | tr ',' ', ')
}

# --- Build scope hint for the agent prompt ---
# Sets SCOPE_HINT to a text block when PLAN_SCOPE is non-empty, empty otherwise.
# Must be called after resolve_scoped_feedback().
build_scope_hint() {
  SCOPE_HINT=""
  if [[ -n "$PLAN_SCOPE" ]]; then
    SCOPE_HINT="
This plan is scoped to ${PLAN_SCOPE}. Focus your changes on files within this directory. Run feedback commands from the repository root — they are already filtered to target this package."
  fi
}

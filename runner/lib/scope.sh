# scope.sh — Monorepo scope resolution and scoped feedback command derivation.
# Sourced by ralphai.sh after prompt.sh. Provides resolve_scoped_feedback().
# Depends on: PLAN_SCOPE, CONFIG_WORKSPACES, FEEDBACK_COMMANDS

# --- Detect the project ecosystem ---
# Sets _RALPHAI_ECOSYSTEM to: node, dotnet, go, rust, java, python, or unknown.
# Uses the same priority order as the TypeScript detectProject() function.
_detect_ecosystem() {
  # Node.js — check JS lockfiles and package.json first (highest priority)
  if [[ -f "pnpm-lock.yaml" || -f "pnpm-workspace.yaml" || \
        -f "yarn.lock" || -f "bun.lockb" || -f "bun.lock" || \
        -f "package-lock.json" || -f "deno.json" || -f "deno.jsonc" || \
        -f "package.json" ]]; then
    _RALPHAI_ECOSYSTEM="node"
    return
  fi

  # .NET — .sln or .csproj
  local f
  for f in *.sln *.csproj; do
    if [[ -f "$f" ]]; then
      _RALPHAI_ECOSYSTEM="dotnet"
      return
    fi
  done

  # Go
  if [[ -f "go.mod" ]]; then
    _RALPHAI_ECOSYSTEM="go"
    return
  fi

  # Rust
  if [[ -f "Cargo.toml" ]]; then
    _RALPHAI_ECOSYSTEM="rust"
    return
  fi

  # Java / Kotlin — Maven or Gradle
  if [[ -f "pom.xml" || -f "build.gradle" || -f "build.gradle.kts" ]]; then
    _RALPHAI_ECOSYSTEM="java"
    return
  fi

  # Python
  if [[ -f "pyproject.toml" || -f "setup.py" || -f "requirements.txt" ]]; then
    _RALPHAI_ECOSYSTEM="python"
    return
  fi

  _RALPHAI_ECOSYSTEM="unknown"
}

# --- Detect the root package manager from lockfiles ---
# Prints: pnpm, yarn, npm, or bun. Falls back to npm if none detected.
# Only meaningful when _RALPHAI_ECOSYSTEM is "node".
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
# For the "node" ecosystem, rewrites PM-based workspace filters.
# For "dotnet", appends the project path to dotnet commands.
# In mixed repos (node primary with dotnet feedback), dotnet commands are
# also scoped when the ecosystem is "node".
# Other ecosystems and non-matching commands pass through unchanged.
_rewrite_command() {
  local pm="$1" pkg_name="$2" cmd="$3"

  # Dotnet commands are scoped regardless of the primary ecosystem,
  # since detectProject() merges dotnet feedback into node in mixed repos.
  if [[ "$cmd" == "dotnet "* ]]; then
    echo "$cmd $PLAN_SCOPE"
    return
  fi

  case "${_RALPHAI_ECOSYSTEM:-unknown}" in
    node)
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
      ;;

    *)
      echo "$cmd"
      ;;
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

  # Detect the project ecosystem
  _detect_ecosystem

  # Check for workspace override first
  if [[ -n "$CONFIG_WORKSPACES" ]]; then
    local ws_fc
    ws_fc=$(echo "$CONFIG_WORKSPACES" | _json_q_stdin "
      const scope = process.argv[1];
      if (scope in data && data[scope].feedbackCommands) {
        const fc = data[scope].feedbackCommands;
        console.log(Array.isArray(fc) ? fc.join(',') : fc);
      }
    " "$PLAN_SCOPE" 2>/dev/null) || ws_fc=""

    if [[ -n "$ws_fc" ]]; then
      FEEDBACK_COMMANDS="$ws_fc"
      FEEDBACK_COMMANDS_TEXT=$(echo "$FEEDBACK_COMMANDS" | tr ',' ', ')
      return 0
    fi
  fi

  # No workspace override — derive scoped commands from detected ecosystem
  if [[ -z "$FEEDBACK_COMMANDS" ]]; then
    return 0
  fi

  # Ecosystems that don't support scoping pass through unchanged
  if [[ "$_RALPHAI_ECOSYSTEM" != "node" && "$_RALPHAI_ECOSYSTEM" != "dotnet" ]]; then
    return 0
  fi

  # For node, we need the package name from the scoped directory's package.json.
  # For dotnet (or dotnet commands in mixed repos), _rewrite_command handles
  # scoping via PLAN_SCOPE directly — no package name needed.
  local pkg_name=""
  local pm=""

  if [[ "$_RALPHAI_ECOSYSTEM" == "node" ]]; then
    local pkg_json="$PLAN_SCOPE/package.json"
    if [[ -f "$pkg_json" ]]; then
      pkg_name=$(_json_q "if (data.name) console.log(data.name)" "$pkg_json" 2>/dev/null) || pkg_name=""
      if [[ -n "$pkg_name" ]]; then
        pm=$(_detect_pm_from_lockfiles)
      fi
    fi
    # When no package.json (e.g., .NET sub-project in a mixed repo), fall
    # through to the rewrite loop — _rewrite_command still scopes dotnet cmds.
  fi

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

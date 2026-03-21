# scope.sh — Monorepo scope resolution and scoped feedback command derivation.
# Sourced by ralphai.sh after prompt.sh. Provides resolve_scoped_feedback().
# Depends on: PLAN_SCOPE, CONFIG_WORKSPACES, FEEDBACK_COMMANDS
#
# All detection and rewriting logic lives in src/scope.ts. This file is a thin
# wrapper that calls the compiled scope-cli.mjs and parses its JSON output.

# Fallback: compute _SCOPE_CLI from this file's location if not already set
# or if the path set by defaults.sh doesn't exist (happens when tests source
# defaults.sh without RALPHAI_LIB_DIR being set by ralphai.sh).
if [[ -z "${_SCOPE_CLI:-}" || ! -f "${_SCOPE_CLI:-}" ]]; then
  _SCOPE_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/dist/scope-cli.mjs"
fi

# --- Resolve scoped feedback commands ---
# Called after config is loaded and PLAN_SCOPE is set.
# Modifies FEEDBACK_COMMANDS, FEEDBACK_COMMANDS_TEXT, _RALPHAI_ECOSYSTEM, and PM.
resolve_scoped_feedback() {
  # No scope → detect ecosystem only (no rewriting needed)
  if [[ -z "$PLAN_SCOPE" ]]; then
    return 0
  fi

  local json
  json=$(node "$_SCOPE_CLI" \
    "$(pwd)" \
    "$PLAN_SCOPE" \
    "$FEEDBACK_COMMANDS" \
    "${CONFIG_WORKSPACES:-}" \
  ) || {
    echo "WARNING: scope-cli failed; using unscoped feedback commands" >&2
    return 0
  }

  # Parse JSON output using _json_q_stdin from json.sh
  FEEDBACK_COMMANDS=$(echo "$json" | _json_q_stdin "console.log(data.feedbackCommands)")
  _RALPHAI_ECOSYSTEM=$(echo "$json" | _json_q_stdin "console.log(data.ecosystem)")
  PM=$(echo "$json" | _json_q_stdin "console.log(data.packageManager)")
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

# --- Detect agent type from command string ---
# Inspects $AGENT_COMMAND and sets DETECTED_AGENT_TYPE to a known identifier.
# Used by prompt formatting to adjust file references per agent.
DETECTED_AGENT_TYPE="unknown"
detect_agent_type() {
  local cmd
  cmd=$(echo "$AGENT_COMMAND" | tr '[:upper:]' '[:lower:]')
  case "$cmd" in
    *claude*)   DETECTED_AGENT_TYPE="claude" ;;
    *opencode*) DETECTED_AGENT_TYPE="opencode" ;;
    *codex*)    DETECTED_AGENT_TYPE="codex" ;;
    *gemini*)   DETECTED_AGENT_TYPE="gemini" ;;
    *aider*)    DETECTED_AGENT_TYPE="aider" ;;
    *goose*)    DETECTED_AGENT_TYPE="goose" ;;
    *kiro*)     DETECTED_AGENT_TYPE="kiro" ;;
    *amp*)      DETECTED_AGENT_TYPE="amp" ;;
    *)          DETECTED_AGENT_TYPE="unknown" ;;
  esac
}
detect_agent_type

# --- Resolve prompt mode and format file references ---
# Maps PROMPT_MODE + DETECTED_AGENT_TYPE to a concrete mode ("at-path" or "inline").
# Called once after agent detection; result cached in RESOLVED_PROMPT_MODE.
RESOLVED_PROMPT_MODE=""
resolve_prompt_mode() {
  if [[ "$PROMPT_MODE" == "at-path" || "$PROMPT_MODE" == "inline" ]]; then
    RESOLVED_PROMPT_MODE="$PROMPT_MODE"
    return
  fi
  # auto mode: pick based on detected agent type
  # Conservative default: everything maps to at-path (current behavior).
  # Agent-specific overrides can be added here as support is verified.
  case "$DETECTED_AGENT_TYPE" in
    claude|opencode) RESOLVED_PROMPT_MODE="at-path" ;;
    *)               RESOLVED_PROMPT_MODE="at-path" ;;
  esac
}
resolve_prompt_mode

# Formats a file reference for the prompt based on the resolved prompt mode.
# Usage: format_file_ref <filepath>
# - at-path mode: echoes "@<filepath>"
# - inline mode: reads the file and wraps contents in <file path="...">...</file>
format_file_ref() {
  local filepath="$1"
  if [[ "$RESOLVED_PROMPT_MODE" == "inline" ]]; then
    if [[ -f "$filepath" ]]; then
      printf '<file path="%s">\n%s\n</file>' "$filepath" "$(cat "$filepath")"
    else
      # File doesn't exist yet — fall back to at-path reference
      printf '@%s' "$filepath"
    fi
  else
    # at-path mode (default)
    printf '@%s' "$filepath"
  fi
}

# --- Build feedback commands text for prompt ---
if [[ -n "$FEEDBACK_COMMANDS" ]]; then
  FEEDBACK_COMMANDS_TEXT=$(echo "$FEEDBACK_COMMANDS" | tr ',' ', ')
else
  FEEDBACK_COMMANDS_TEXT=""
fi

# --- Conditional LEARNINGS.md references ---
# .ralphai/LEARNINGS.md is where Ralphai writes its own learnings (gitignored).
LEARNINGS_REF=""
LEARNINGS_HINT=""
LEARNINGS_STEP=""
RALPHAI_LEARNINGS_FILE=".ralphai/LEARNINGS.md"
if [[ -f "$RALPHAI_LEARNINGS_FILE" ]]; then
  LEARNINGS_REF=" $(format_file_ref "$RALPHAI_LEARNINGS_FILE")"
  LEARNINGS_HINT=" Also read $RALPHAI_LEARNINGS_FILE to avoid repeating past mistakes."
  LEARNINGS_STEP="
6. If you make a mistake (wrong assumption, broken build, misunderstood requirement, flawed approach), log it in $RALPHAI_LEARNINGS_FILE with the date, what went wrong, the root cause, and how to prevent it. When useful, note high-value recurring patterns in progress.txt so the maintainer can promote them into AGENTS.md or skill docs."
fi

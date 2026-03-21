# validate.sh — Agent-type detection.
# Sourced by ralphai.sh. Provides detect_agent_type().
#
# Validation helpers (validate_enum, validate_boolean, validate_positive_int,
# validate_nonneg_int, validate_comma_list) have moved to TypeScript
# (src/config.ts). Only detect_agent_type() remains in shell because it
# is called at runtime by prompt.sh and show_config.sh.

# --- Detect agent type from command string ---
# Inspects $AGENT_COMMAND and sets DETECTED_AGENT_TYPE to a known identifier.
# Used by prompt formatting to adjust file references per agent.
# NOTE: Not called at source-time — called explicitly by prompt.sh.
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

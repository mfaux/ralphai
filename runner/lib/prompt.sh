# detect_agent_type() is defined in validate.sh (sourced earlier).
# Call it here to set DETECTED_AGENT_TYPE based on the resolved AGENT_COMMAND.
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
RALPHAI_LEARNING_CANDIDATES_FILE=".ralphai/LEARNING_CANDIDATES.md"

if [[ -f "$RALPHAI_LEARNINGS_FILE" ]]; then
  LEARNINGS_REF=" $(format_file_ref "$RALPHAI_LEARNINGS_FILE")"
  LEARNINGS_HINT=" Also read $RALPHAI_LEARNINGS_FILE as a rolling anti-repeat memory. Apply durable lessons, but do not overfit to stale or overly specific anecdotes."
  LEARNINGS_STEP="
6. Read $RALPHAI_LEARNINGS_FILE before making changes. Treat it as advisory memory, not as ground truth.
   - Apply durable repo and workflow constraints immediately.
   - Prefer general rules over narrow anecdotes.
   - Be cautious with old, task-specific, or overly detailed entries.
   - If multiple entries overlap, follow the shared rule rather than the most specific incident.

7. If you make a mistake, add or update an entry in $RALPHAI_LEARNINGS_FILE only if it would help future runs avoid the same class of error.
   Each entry must include:
   - Date
   - What went wrong
   - Root cause
   - Fix / Prevention

   When writing learnings:
   - Generalize the incident into a reusable rule.
   - Keep the entry concise.
   - Do not log one-off typos, incidental dead ends, or highly specific details unless they reveal a reusable pattern.
   - Do not create duplicate entries; merge or refine an existing entry when the lesson already exists.

8. If a lesson appears durable, repo-specific, or useful beyond the current task, do not edit AGENTS.md.
   Instead, append a short candidate entry to $RALPHAI_LEARNING_CANDIDATES_FILE for later human review.

9. Treat $RALPHAI_LEARNING_CANDIDATES_FILE as a review queue, not as active instructions.
   Candidate entries should include:
   - Date
   - Proposed rule
   - Why it matters
   - Suggested destination

10. Never edit AGENTS.md automatically based on learnings or candidates."
fi

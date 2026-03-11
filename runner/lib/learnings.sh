# --- Learnings parser and writer ---
# Parses structured <learnings> blocks from agent output and appends
# logged entries to .ralphai/LEARNINGS.md.

RALPHAI_LEARNINGS_FILE=".ralphai/LEARNINGS.md"
RALPHAI_LEARNING_CANDIDATES_FILE=".ralphai/LEARNING_CANDIDATES.md"

# Extracts the first <learnings>...</learnings> block from input text.
# Returns the block content (between tags) on stdout, or empty if not found.
# Usage: extract_learnings_block "$agent_output"
extract_learnings_block() {
  local text="$1"
  # Use sed to extract content between <learnings> and </learnings>
  local block
  block=$(printf '%s' "$text" | sed -n '/<learnings>/,/<\/learnings>/{ /<learnings>/d; /<\/learnings>/d; p; }')
  if [[ -n "$block" ]]; then
    printf '%s' "$block"
    return 0
  fi
  return 1
}

# Parses key fields from a <learnings> entry block.
# Sets global variables: LEARNING_STATUS, LEARNING_DATE, LEARNING_TITLE,
# LEARNING_WHAT, LEARNING_ROOT_CAUSE, LEARNING_PREVENTION
# Returns 0 on success, 1 on parse failure.
# Usage: parse_learnings_entry "$block_content"
parse_learnings_entry() {
  local block="$1"

  # Reset fields
  LEARNING_STATUS=""
  LEARNING_DATE=""
  LEARNING_TITLE=""
  LEARNING_WHAT=""
  LEARNING_ROOT_CAUSE=""
  LEARNING_PREVENTION=""

  # Extract entry content between <entry> and </entry>
  local entry
  entry=$(printf '%s' "$block" | sed -n '/<entry>/,/<\/entry>/{ /<entry>/d; /<\/entry>/d; p; }')
  if [[ -z "$entry" ]]; then
    return 1
  fi

  # Parse status (required)
  LEARNING_STATUS=$(printf '%s' "$entry" | sed -n 's/^status:[[:space:]]*//p' | head -1 | tr -d '[:space:]')
  if [[ -z "$LEARNING_STATUS" ]]; then
    return 1
  fi

  # If status is "none", no other fields needed
  if [[ "$LEARNING_STATUS" == "none" ]]; then
    return 0
  fi

  # For "logged" status, extract remaining fields
  if [[ "$LEARNING_STATUS" == "logged" ]]; then
    LEARNING_DATE=$(printf '%s' "$entry" | sed -n 's/^date:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*$//')
    LEARNING_TITLE=$(printf '%s' "$entry" | sed -n 's/^title:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*$//')
    LEARNING_WHAT=$(printf '%s' "$entry" | sed -n 's/^what:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*$//')
    LEARNING_ROOT_CAUSE=$(printf '%s' "$entry" | sed -n 's/^root_cause:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*$//')
    LEARNING_PREVENTION=$(printf '%s' "$entry" | sed -n 's/^prevention:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*$//')

    # Validate required fields for logged entries
    if [[ -z "$LEARNING_DATE" || -z "$LEARNING_TITLE" || -z "$LEARNING_WHAT" || -z "$LEARNING_ROOT_CAUSE" || -z "$LEARNING_PREVENTION" ]]; then
      return 1
    fi
    return 0
  fi

  # Unknown status value
  return 1
}

# Appends a normalized Markdown entry to .ralphai/LEARNINGS.md.
# Creates the file with a seed header if it doesn't exist.
# Usage: append_learning_entry
# Reads from LEARNING_DATE, LEARNING_TITLE, LEARNING_WHAT,
# LEARNING_ROOT_CAUSE, LEARNING_PREVENTION globals.
append_learning_entry() {
  # Create file with seed header if missing
  if [[ ! -f "$RALPHAI_LEARNINGS_FILE" ]]; then
    mkdir -p "$(dirname "$RALPHAI_LEARNINGS_FILE")"
    cat > "$RALPHAI_LEARNINGS_FILE" <<'SEED'
# Ralphai Learnings

Mistakes and lessons learned during autonomous runs. This file is **gitignored** —
Ralphai reads and writes it automatically. Review periodically and promote useful
entries to `AGENTS.md` or skill docs when they have lasting value.

## Format

Each entry should include:

- **Date**: When the mistake was made
- **What went wrong**: Brief description of the error
- **Root cause**: Why it happened
- **Fix / Prevention**: How to avoid it in the future

---

<!-- Entries are added automatically by Ralphai during autonomous runs -->
SEED
  fi

  # Append normalized Markdown entry
  cat >> "$RALPHAI_LEARNINGS_FILE" <<EOF

### ${LEARNING_DATE} — ${LEARNING_TITLE}

**What went wrong:** ${LEARNING_WHAT}

**Root cause:** ${LEARNING_ROOT_CAUSE}

**Fix / Prevention:** ${LEARNING_PREVENTION}
EOF
}

# Creates .ralphai/LEARNING_CANDIDATES.md with a seed header if it doesn't exist.
# Usage: seed_learning_candidates_file
seed_learning_candidates_file() {
  if [[ -f "$RALPHAI_LEARNING_CANDIDATES_FILE" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$RALPHAI_LEARNING_CANDIDATES_FILE")"
  cat > "$RALPHAI_LEARNING_CANDIDATES_FILE" <<'SEED'
# Ralphai Learning Candidates

Potential durable lessons for human review and possible promotion into AGENTS.md or skill docs.

## Format

- Date
- Proposed rule
- Why it matters
- Suggested destination

---

<!-- Append new candidate entries below -->
SEED
}

# Prunes .ralphai/LEARNINGS.md to keep only the most recent MAX_LEARNINGS entries.
# Entries are delimited by "### " headings. The file header (everything before the
# first entry) is always preserved. No-op if the file doesn't exist or has fewer
# entries than the limit.
# Usage: prune_learnings_file
prune_learnings_file() {
  if [[ ! -f "$RALPHAI_LEARNINGS_FILE" ]]; then
    return 0
  fi

  local max="${MAX_LEARNINGS:-20}"
  if [[ "$max" -le 0 ]]; then
    return 0
  fi

  # Count entry headings (lines starting with "### ")
  local count
  count=$(grep -c '^### ' "$RALPHAI_LEARNINGS_FILE" 2>/dev/null || echo 0)
  if [[ "$count" -le "$max" ]]; then
    return 0
  fi

  # Split: header = everything before first "### ", entries = rest
  local header entries kept
  header=$(sed '/^### /,$d' "$RALPHAI_LEARNINGS_FILE")

  # Extract the last $max entries (each entry starts with "### ")
  # Use awk to split on "### " boundaries and keep the tail
  local drop=$(( count - max ))
  kept=$(awk -v drop="$drop" '
    /^### / { entry_num++ }
    entry_num > drop { print }
  ' "$RALPHAI_LEARNINGS_FILE")

  # Rewrite the file: header + kept entries
  printf '%s\n%s\n' "$header" "$kept" > "$RALPHAI_LEARNINGS_FILE"
}

# Processes the learnings block from agent output.
# Extracts, parses, and appends if status is "logged".
# Prints status messages for each outcome.
# Usage: process_learnings "$agent_output"
process_learnings() {
  local agent_output="$1"

  # Ensure candidates file exists for agent to append to
  seed_learning_candidates_file

  local block
  if ! block=$(extract_learnings_block "$agent_output"); then
    echo "WARNING: No <learnings> block found in agent output."
    return 0
  fi

  if ! parse_learnings_entry "$block"; then
    echo "WARNING: Malformed <learnings> block — could not parse entry fields."
    return 0
  fi

  if [[ "$LEARNING_STATUS" == "none" ]]; then
    echo "No learning logged this turn."
    return 0
  fi

  if [[ "$LEARNING_STATUS" == "logged" ]]; then
    append_learning_entry
    prune_learnings_file
    echo "Logged learning: ${LEARNING_TITLE}"
    return 0
  fi

  echo "WARNING: Unknown learnings status: $LEARNING_STATUS"
  return 0
}

# validate.sh — Shared validation helpers and agent-type detection.
# Sourced by ralphai.sh before config.sh. Provides reusable validators
# for enum, boolean, integer, and comma-list config values.

# --- Enum validation ---
# validate_enum <value> <label> <allowed_1> [allowed_2] ...
# Exits with error if value is not in the allowed list.
# Error: "ERROR: <label> must be '<a>', '<b>', or '<c>', got '<value>'"
validate_enum() {
  local value="$1" label="$2"
  shift 2
  local allowed=("$@")
  for a in "${allowed[@]}"; do
    if [[ "$value" == "$a" ]]; then
      return 0
    fi
  done
  # Build human-readable list: 'a', 'b', or 'c'
  local msg=""
  local count=${#allowed[@]}
  if [[ $count -eq 1 ]]; then
    msg="'${allowed[0]}'"
  elif [[ $count -eq 2 ]]; then
    msg="'${allowed[0]}' or '${allowed[1]}'"
  else
    for ((i = 0; i < count; i++)); do
      if [[ $i -eq $((count - 1)) ]]; then
        msg="${msg}or '${allowed[$i]}'"
      else
        msg="${msg}'${allowed[$i]}', "
      fi
    done
  fi
  echo "ERROR: $label must be $msg, got '$value'"
  exit 1
}

# --- Boolean validation ---
# validate_boolean <value> <label>
# Shorthand for validate_enum with "true" and "false".
validate_boolean() {
  validate_enum "$1" "$2" "true" "false"
}

# --- Positive integer validation ---
# validate_positive_int <value> <label>
# Exits if value doesn't match ^[1-9][0-9]*$.
# Error: "ERROR: <label> must be a positive integer, got '<value>'"
validate_positive_int() {
  local value="$1" label="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: $label must be a positive integer, got '$value'"
    exit 1
  fi
}

# --- Non-negative integer validation ---
# validate_nonneg_int <value> <label> [hint]
# Exits if value doesn't match ^[0-9]+$.
# Error: "ERROR: <label> must be a non-negative integer, got '<value>'"
# With hint: "ERROR: <label> must be a non-negative integer (<hint>), got '<value>'"
validate_nonneg_int() {
  local value="$1" label="$2" hint="${3:-}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    if [[ -n "$hint" ]]; then
      echo "ERROR: $label must be a non-negative integer ($hint), got '$value'"
    else
      echo "ERROR: $label must be a non-negative integer, got '$value'"
    fi
    exit 1
  fi
}

# --- Comma-separated list validation ---
# validate_comma_list <value> <label>
# Splits on commas, trims whitespace, exits if any entry is empty.
# Error: "ERROR: <label> contains an empty entry"
validate_comma_list() {
  local value="$1" label="$2"
  if [[ -z "$value" ]]; then
    return 0
  fi
  local IFS=','
  read -ra parts <<< "$value"
  for part in "${parts[@]}"; do
    local trimmed
    trimmed=$(echo "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [[ -z "$trimmed" ]]; then
      echo "ERROR: $label contains an empty entry"
      exit 1
    fi
  done
}

# --- Detect agent type from command string ---
# Inspects $AGENT_COMMAND and sets DETECTED_AGENT_TYPE to a known identifier.
# Used by prompt formatting to adjust file references per agent.
# NOTE: Not called at source-time — called explicitly by cli.sh and prompt.sh.
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

# config.sh — Configuration file loading and env var overrides.
# Sourced by ralphai.sh. Contains load_config(), apply_config(),
# and apply_env_overrides(). CLI parsing is in cli.sh.

# --- Config file loader ---
# Parses ralphai.json (JSON format via jq).
# Sets CONFIG_AGENT_COMMAND, CONFIG_FEEDBACK_COMMANDS, CONFIG_BASE_BRANCH,
# CONFIG_MAX_STUCK, CONFIG_MODE, CONFIG_PROMPT_MODE when present.
# Fails fast on unknown keys or invalid values.
load_config() {
  local config_path="$1"

  # Missing config file is a no-op
  if [[ ! -f "$config_path" ]]; then
    return 0
  fi

  # Validate JSON syntax
  if ! jq empty "$config_path" 2>/dev/null; then
    echo "ERROR: $config_path: invalid JSON"
    exit 1
  fi

  # Must be a JSON object
  local json_type
  json_type=$(jq -r 'type' "$config_path")
  if [[ "$json_type" != "object" ]]; then
    echo "ERROR: $config_path: expected a JSON object, got $json_type"
    exit 1
  fi

  # Check for unknown keys
  local unknown_keys
  unknown_keys=$(jq -r 'keys[] | select(. as $k | ["agentCommand","feedbackCommands","baseBranch","maxStuck","mode","issueCloseOnComplete","issueSource","issueLabel","issueInProgressLabel","issueRepo","issueCommentProgress","turnTimeout","promptMode","continuous","autoCommit","turns"] | index($k) | not)' "$config_path")
  if [[ -n "$unknown_keys" ]]; then
    local first_unknown
    first_unknown=$(echo "$unknown_keys" | head -1)
    echo "WARNING: $config_path: ignoring unknown config key '$first_unknown'"
  fi

  # Helper: read a string value from JSON (returns empty if key is missing or null)
  _json_str() {
    jq -r "if has(\"$1\") then .$1 // \"\" else \"\" end" "$config_path"
  }

  # Helper: read a raw value (preserves type info for validation)
  _json_raw() {
    jq -r "if has(\"$1\") then (.$1 | tostring) else \"\" end" "$config_path"
  }

  # Helper: check if key exists
  _json_has() {
    jq -e "has(\"$1\")" "$config_path" >/dev/null 2>&1
  }

  local value

  # --- agentCommand (string, non-empty) ---
  if _json_has "agentCommand"; then
    value=$(_json_str "agentCommand")
    if [[ -z "$value" ]]; then
      echo "ERROR: $config_path: 'agentCommand' must be a non-empty string"
      exit 1
    fi
    CONFIG_AGENT_COMMAND="$value"
  fi

  # --- feedbackCommands (array of strings or comma-separated string) ---
  if _json_has "feedbackCommands"; then
    local fc_type
    fc_type=$(jq -r '.feedbackCommands | type' "$config_path")
    if [[ "$fc_type" == "array" ]]; then
      # Join array elements with commas (matches internal format)
      value=$(jq -r '.feedbackCommands | join(",")' "$config_path")
      validate_comma_list "$value" "$config_path: 'feedbackCommands' array"
    elif [[ "$fc_type" == "string" ]]; then
      value=$(_json_str "feedbackCommands")
      validate_comma_list "$value" "$config_path: 'feedbackCommands'"
    else
      echo "ERROR: $config_path: 'feedbackCommands' must be an array of strings or a comma-separated string, got $fc_type"
      exit 1
    fi
    CONFIG_FEEDBACK_COMMANDS="$value"
  fi

  # --- baseBranch (string, non-empty, no spaces) ---
  if _json_has "baseBranch"; then
    value=$(_json_str "baseBranch")
    if [[ -z "$value" ]]; then
      echo "ERROR: $config_path: 'baseBranch' must be a non-empty branch name"
      exit 1
    fi
    if [[ "$value" =~ [[:space:]] ]]; then
      echo "ERROR: $config_path: 'baseBranch' must be a single token without spaces, got '$value'"
      exit 1
    fi
    CONFIG_BASE_BRANCH="$value"
  fi

  # --- maxStuck (positive integer) ---
  if _json_has "maxStuck"; then
    value=$(_json_raw "maxStuck")
    validate_positive_int "$value" "$config_path: 'maxStuck'"
    CONFIG_MAX_STUCK="$value"
  fi

  # --- mode ("branch", "pr", or "patch") ---
  if _json_has "mode"; then
    value=$(_json_str "mode")
    validate_enum "$value" "$config_path: 'mode'" "branch" "pr" "patch"
    CONFIG_MODE="$value"
  fi

  # --- issueCloseOnComplete (boolean) ---
  if _json_has "issueCloseOnComplete"; then
    value=$(_json_raw "issueCloseOnComplete")
    validate_boolean "$value" "$config_path: 'issueCloseOnComplete'"
    CONFIG_ISSUE_CLOSE_ON_COMPLETE="$value"
  fi

  # --- issueSource ("none" or "github") ---
  if _json_has "issueSource"; then
    value=$(_json_str "issueSource")
    validate_enum "$value" "$config_path: 'issueSource'" "none" "github"
    CONFIG_ISSUE_SOURCE="$value"
  fi

  # --- issueLabel (string, non-empty) ---
  if _json_has "issueLabel"; then
    value=$(_json_str "issueLabel")
    if [[ -z "$value" ]]; then
      echo "ERROR: $config_path: 'issueLabel' must be a non-empty label name"
      exit 1
    fi
    CONFIG_ISSUE_LABEL="$value"
  fi

  # --- issueInProgressLabel (string, non-empty) ---
  if _json_has "issueInProgressLabel"; then
    value=$(_json_str "issueInProgressLabel")
    if [[ -z "$value" ]]; then
      echo "ERROR: $config_path: 'issueInProgressLabel' must be a non-empty label name"
      exit 1
    fi
    CONFIG_ISSUE_IN_PROGRESS_LABEL="$value"
  fi

  # --- issueRepo (string, can be empty) ---
  if _json_has "issueRepo"; then
    value=$(_json_str "issueRepo")
    CONFIG_ISSUE_REPO="$value"
  fi

  # --- issueCommentProgress (boolean) ---
  if _json_has "issueCommentProgress"; then
    value=$(_json_raw "issueCommentProgress")
    validate_boolean "$value" "$config_path: 'issueCommentProgress'"
    CONFIG_ISSUE_COMMENT_PROGRESS="$value"
  fi

  # --- turnTimeout (non-negative integer) ---
  if _json_has "turnTimeout"; then
    value=$(_json_raw "turnTimeout")
    validate_nonneg_int "$value" "$config_path: 'turnTimeout'" "seconds"
    CONFIG_TURN_TIMEOUT="$value"
  fi

  # --- promptMode ("auto", "at-path", or "inline") ---
  if _json_has "promptMode"; then
    value=$(_json_str "promptMode")
    validate_enum "$value" "$config_path: 'promptMode'" "auto" "at-path" "inline"
    CONFIG_PROMPT_MODE="$value"
  fi

  # --- continuous (boolean) ---
  if _json_has "continuous"; then
    value=$(_json_raw "continuous")
    validate_boolean "$value" "$config_path: 'continuous'"
    CONFIG_CONTINUOUS="$value"
  fi


  # --- autoCommit (boolean) ---
  if _json_has "autoCommit"; then
    value=$(_json_raw "autoCommit")
    validate_boolean "$value" "$config_path: 'autoCommit'"
    CONFIG_AUTO_COMMIT="$value"
  fi

  # --- turns (non-negative integer, 0 = unlimited) ---
  if _json_has "turns"; then
    value=$(_json_raw "turns")
    validate_nonneg_int "$value" "$config_path: 'turns'" "0 = unlimited"
    CONFIG_TURNS="$value"
  fi
}

# --- Apply config file settings ---
# Called after load_config to merge config values into resolved settings.
apply_config() {
  if [[ -n "${CONFIG_AGENT_COMMAND:-}" ]]; then
    AGENT_COMMAND="$CONFIG_AGENT_COMMAND"
  fi
  if [[ -n "${CONFIG_FEEDBACK_COMMANDS:-}" ]]; then
    FEEDBACK_COMMANDS="$CONFIG_FEEDBACK_COMMANDS"
  fi
  if [[ -n "${CONFIG_BASE_BRANCH:-}" ]]; then
    BASE_BRANCH="$CONFIG_BASE_BRANCH"
  fi
  if [[ -n "${CONFIG_MAX_STUCK:-}" ]]; then
    MAX_STUCK="$CONFIG_MAX_STUCK"
  fi
  if [[ -n "${CONFIG_MODE:-}" ]]; then
    MODE="$CONFIG_MODE"
  fi
  if [[ -n "${CONFIG_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    ISSUE_CLOSE_ON_COMPLETE="$CONFIG_ISSUE_CLOSE_ON_COMPLETE"
  fi
  if [[ -n "${CONFIG_ISSUE_SOURCE:-}" ]]; then
    ISSUE_SOURCE="$CONFIG_ISSUE_SOURCE"
  fi
  if [[ -n "${CONFIG_ISSUE_LABEL:-}" ]]; then
    ISSUE_LABEL="$CONFIG_ISSUE_LABEL"
  fi
  if [[ -n "${CONFIG_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    ISSUE_IN_PROGRESS_LABEL="$CONFIG_ISSUE_IN_PROGRESS_LABEL"
  fi
  if [[ -n "${CONFIG_ISSUE_REPO:-}" ]]; then
    ISSUE_REPO="$CONFIG_ISSUE_REPO"
  fi
  if [[ -n "${CONFIG_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    ISSUE_COMMENT_PROGRESS="$CONFIG_ISSUE_COMMENT_PROGRESS"
  fi
  if [[ -n "${CONFIG_TURN_TIMEOUT:-}" ]]; then
    TURN_TIMEOUT="$CONFIG_TURN_TIMEOUT"
  fi
  if [[ -n "${CONFIG_PROMPT_MODE:-}" ]]; then
    PROMPT_MODE="$CONFIG_PROMPT_MODE"
  fi
  if [[ -n "${CONFIG_CONTINUOUS:-}" ]]; then
    CONTINUOUS="$CONFIG_CONTINUOUS"
  fi
  if [[ -n "${CONFIG_AUTO_COMMIT:-}" ]]; then
    AUTO_COMMIT="$CONFIG_AUTO_COMMIT"
  fi
  if [[ -n "${CONFIG_TURNS:-}" ]]; then
    TURNS="$CONFIG_TURNS"
  fi
}

# --- Apply env var overrides ---
# Env vars override config file values but are overridden by CLI flags.
apply_env_overrides() {
  if [[ -n "${RALPHAI_AGENT_COMMAND:-}" ]]; then
    AGENT_COMMAND="$RALPHAI_AGENT_COMMAND"
  fi
  if [[ -n "${RALPHAI_FEEDBACK_COMMANDS:-}" ]]; then
    FEEDBACK_COMMANDS="$RALPHAI_FEEDBACK_COMMANDS"
  fi
  if [[ -n "${RALPHAI_BASE_BRANCH:-}" ]]; then
    if [[ "$RALPHAI_BASE_BRANCH" =~ [[:space:]] ]]; then
      echo "ERROR: RALPHAI_BASE_BRANCH must be a single token without spaces, got '$RALPHAI_BASE_BRANCH'"
      exit 1
    fi
    BASE_BRANCH="$RALPHAI_BASE_BRANCH"
  fi
  if [[ -n "${RALPHAI_MAX_STUCK:-}" ]]; then
    validate_positive_int "$RALPHAI_MAX_STUCK" "RALPHAI_MAX_STUCK"
    MAX_STUCK="$RALPHAI_MAX_STUCK"
  fi
  if [[ -n "${RALPHAI_MODE:-}" ]]; then
    validate_enum "$RALPHAI_MODE" "RALPHAI_MODE" "branch" "pr" "patch"
    MODE="$RALPHAI_MODE"
  fi
  if [[ -n "${RALPHAI_TURN_TIMEOUT:-}" ]]; then
    validate_nonneg_int "$RALPHAI_TURN_TIMEOUT" "RALPHAI_TURN_TIMEOUT" "seconds"
    TURN_TIMEOUT="$RALPHAI_TURN_TIMEOUT"
  fi
  if [[ -n "${RALPHAI_ISSUE_SOURCE:-}" ]]; then
    validate_enum "$RALPHAI_ISSUE_SOURCE" "RALPHAI_ISSUE_SOURCE" "none" "github"
    ISSUE_SOURCE="$RALPHAI_ISSUE_SOURCE"
  fi
  if [[ -n "${RALPHAI_ISSUE_LABEL:-}" ]]; then
    ISSUE_LABEL="$RALPHAI_ISSUE_LABEL"
  fi
  if [[ -n "${RALPHAI_ISSUE_IN_PROGRESS_LABEL:-}" ]]; then
    ISSUE_IN_PROGRESS_LABEL="$RALPHAI_ISSUE_IN_PROGRESS_LABEL"
  fi
  if [[ -n "${RALPHAI_ISSUE_REPO:-}" ]]; then
    ISSUE_REPO="$RALPHAI_ISSUE_REPO"
  fi
  if [[ -n "${RALPHAI_ISSUE_CLOSE_ON_COMPLETE:-}" ]]; then
    validate_boolean "$RALPHAI_ISSUE_CLOSE_ON_COMPLETE" "RALPHAI_ISSUE_CLOSE_ON_COMPLETE"
    ISSUE_CLOSE_ON_COMPLETE="$RALPHAI_ISSUE_CLOSE_ON_COMPLETE"
  fi
  if [[ -n "${RALPHAI_ISSUE_COMMENT_PROGRESS:-}" ]]; then
    validate_boolean "$RALPHAI_ISSUE_COMMENT_PROGRESS" "RALPHAI_ISSUE_COMMENT_PROGRESS"
    ISSUE_COMMENT_PROGRESS="$RALPHAI_ISSUE_COMMENT_PROGRESS"
  fi
  if [[ -n "${RALPHAI_PROMPT_MODE:-}" ]]; then
    validate_enum "$RALPHAI_PROMPT_MODE" "RALPHAI_PROMPT_MODE" "auto" "at-path" "inline"
    PROMPT_MODE="$RALPHAI_PROMPT_MODE"
  fi
  if [[ -n "${RALPHAI_CONTINUOUS:-}" ]]; then
    validate_boolean "$RALPHAI_CONTINUOUS" "RALPHAI_CONTINUOUS"
    CONTINUOUS="$RALPHAI_CONTINUOUS"
  fi
  if [[ -n "${RALPHAI_AUTO_COMMIT:-}" ]]; then
    validate_boolean "$RALPHAI_AUTO_COMMIT" "RALPHAI_AUTO_COMMIT"
    AUTO_COMMIT="$RALPHAI_AUTO_COMMIT"
  fi
  if [[ -n "${RALPHAI_TURNS:-}" ]]; then
    validate_nonneg_int "$RALPHAI_TURNS" "RALPHAI_TURNS" "0 = unlimited"
    TURNS="$RALPHAI_TURNS"
  fi
}



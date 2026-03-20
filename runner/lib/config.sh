# config.sh — Configuration file loading and env var overrides.
# Sourced by ralphai.sh. Contains load_config(), apply_config(),
# and apply_env_overrides(). CLI parsing is in cli.sh.

# --- Config file loader ---
# Parses ralphai.json in a single Node.js invocation (avoiding ~35 separate
# node -e calls that accumulated ~15-30 s on Windows due to V8 startup cost).
# Sets CONFIG_AGENT_COMMAND, CONFIG_FEEDBACK_COMMANDS, CONFIG_BASE_BRANCH,
# CONFIG_MAX_STUCK, CONFIG_MODE, CONFIG_PROMPT_MODE when present.
# Fails fast on unknown keys or invalid values.
load_config() {
  local config_path="$1"

  # Missing config file is a no-op
  if [[ ! -f "$config_path" ]]; then
    return 0
  fi

  # Single Node.js invocation: validate + extract all config values.
  # Output format: one "KEY=VALUE" per line for simple values,
  # "KEY_JSON=<json>" for complex objects, "WARNING:msg" for warnings,
  # "ERROR:msg" for fatal errors.
  local node_output
  if ! node_output=$(node -e "
    'use strict';
    const fs = require('fs');
    const file = process.argv[1];
    let raw;
    try { raw = fs.readFileSync(file, 'utf-8'); } catch (e) {
      console.log('ERROR:' + file + ': cannot read file: ' + e.message);
      process.exit(0);
    }
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      console.log('ERROR:' + file + ': invalid JSON');
      process.exit(0);
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      const t = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
      console.log('ERROR:' + file + ': expected a JSON object, got ' + t);
      process.exit(0);
    }
    const allowed = new Set(['agentCommand','feedbackCommands','baseBranch','maxStuck','mode','issueSource','issueLabel','issueInProgressLabel','issueRepo','issueCommentProgress','turnTimeout','promptMode','continuous','autoCommit','turns','maxLearnings','workspaces']);
    const unknown = Object.keys(data).filter(k => !allowed.has(k));
    if (unknown.length > 0) console.log('WARNING:' + file + \": ignoring unknown config key '\" + unknown[0] + \"'\");
    function emit(key, val) { console.log(key + '=' + val); }
    function err(msg) { console.log('ERROR:' + file + ': ' + msg); process.exit(0); }

    // agentCommand (string, non-empty)
    if ('agentCommand' in data) {
      const v = data.agentCommand;
      if (typeof v !== 'string' || v === '') err(\"'agentCommand' must be a non-empty string\");
      else emit('CONFIG_AGENT_COMMAND', v);
    }

    // feedbackCommands (array of strings or comma-separated string)
    if ('feedbackCommands' in data) {
      const v = data.feedbackCommands;
      if (Array.isArray(v)) {
        const joined = v.join(',');
        // Validate no empty entries
        if (v.some(s => typeof s !== 'string' || s.trim() === ''))
          err(\"'feedbackCommands' array contains an empty entry\");
        else emit('CONFIG_FEEDBACK_COMMANDS', joined);
      } else if (typeof v === 'string') {
        emit('CONFIG_FEEDBACK_COMMANDS', v);
      } else {
        err(\"'feedbackCommands' must be an array of strings or a comma-separated string, got \" + typeof v);
      }
    }

    // baseBranch (string, non-empty, no spaces)
    if ('baseBranch' in data) {
      const v = String(data.baseBranch || '');
      if (v === '') err(\"'baseBranch' must be a non-empty branch name\");
      else if (/\s/.test(v)) err(\"'baseBranch' must be a single token without spaces, got '\" + v + \"'\");
      else emit('CONFIG_BASE_BRANCH', v);
    }

    // maxStuck (positive integer)
    if ('maxStuck' in data) {
      const v = data.maxStuck;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
        err(\"'maxStuck' must be a positive integer, got '\" + v + \"'\");
      else emit('CONFIG_MAX_STUCK', v);
    }

    // mode (enum)
    if ('mode' in data) {
      const v = String(data.mode || '');
      if (!['branch','pr','patch'].includes(v))
        err(\"'mode' must be 'branch', 'pr', or 'patch', got '\" + v + \"'\");
      else emit('CONFIG_MODE', v);
    }

    // issueSource (enum)
    if ('issueSource' in data) {
      const v = String(data.issueSource || '');
      if (!['none','github'].includes(v))
        err(\"'issueSource' must be 'none' or 'github', got '\" + v + \"'\");
      else emit('CONFIG_ISSUE_SOURCE', v);
    }

    // issueLabel (string, non-empty)
    if ('issueLabel' in data) {
      const v = String(data.issueLabel || '');
      if (v === '') err(\"'issueLabel' must be a non-empty label name\");
      else emit('CONFIG_ISSUE_LABEL', v);
    }

    // issueInProgressLabel (string, non-empty)
    if ('issueInProgressLabel' in data) {
      const v = String(data.issueInProgressLabel || '');
      if (v === '') err(\"'issueInProgressLabel' must be a non-empty label name\");
      else emit('CONFIG_ISSUE_IN_PROGRESS_LABEL', v);
    }

    // issueRepo (string, can be empty)
    if ('issueRepo' in data) {
      emit('CONFIG_ISSUE_REPO', String(data.issueRepo || ''));
    }

    // issueCommentProgress (boolean)
    if ('issueCommentProgress' in data) {
      const v = data.issueCommentProgress;
      if (typeof v !== 'boolean')
        err(\"'issueCommentProgress' must be 'true' or 'false', got '\" + v + \"'\");
      else emit('CONFIG_ISSUE_COMMENT_PROGRESS', v);
    }

    // turnTimeout (non-negative integer)
    if ('turnTimeout' in data) {
      const v = data.turnTimeout;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        err(\"'turnTimeout' must be a non-negative integer (seconds), got '\" + v + \"'\");
      else emit('CONFIG_TURN_TIMEOUT', v);
    }

    // promptMode (enum)
    if ('promptMode' in data) {
      const v = String(data.promptMode || '');
      if (!['auto','at-path','inline'].includes(v))
        err(\"'promptMode' must be 'auto', 'at-path', or 'inline', got '\" + v + \"'\");
      else emit('CONFIG_PROMPT_MODE', v);
    }

    // continuous (boolean)
    if ('continuous' in data) {
      const v = data.continuous;
      if (typeof v !== 'boolean')
        err(\"'continuous' must be 'true' or 'false', got '\" + v + \"'\");
      else emit('CONFIG_CONTINUOUS', v);
    }

    // autoCommit (boolean)
    if ('autoCommit' in data) {
      const v = data.autoCommit;
      if (typeof v !== 'boolean')
        err(\"'autoCommit' must be 'true' or 'false', got '\" + v + \"'\");
      else emit('CONFIG_AUTO_COMMIT', v);
    }

    // turns (non-negative integer, 0 = unlimited)
    if ('turns' in data) {
      const v = data.turns;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        err(\"'turns' must be a non-negative integer (0 = unlimited), got '\" + v + \"'\");
      else emit('CONFIG_TURNS', v);
    }

    // maxLearnings (non-negative integer, 0 = unlimited)
    if ('maxLearnings' in data) {
      const v = data.maxLearnings;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        err(\"'maxLearnings' must be a non-negative integer (0 = unlimited), got '\" + v + \"'\");
      else emit('CONFIG_MAX_LEARNINGS', v);
    }

    // workspaces (object of per-package overrides)
    if ('workspaces' in data) {
      const ws = data.workspaces;
      if (ws === null || typeof ws !== 'object' || Array.isArray(ws)) {
        const t = ws === null ? 'null' : Array.isArray(ws) ? 'array' : typeof ws;
        err(\"'workspaces' must be an object, got \" + t);
      } else {
        for (const k of Object.keys(ws)) {
          const entry = ws[k];
          if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            const t = entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry;
            err(\"workspaces['\" + k + \"'] must be an object, got \" + t);
          }
          if (entry && 'feedbackCommands' in entry) {
            const fc = entry.feedbackCommands;
            if (!Array.isArray(fc) && typeof fc !== 'string')
              err(\"workspaces['\" + k + \"'].feedbackCommands must be an array of strings or a comma-separated string, got \" + typeof fc);
          }
        }
        emit('CONFIG_WORKSPACES_JSON', JSON.stringify(ws));
      }
    }
  " "$config_path" 2>/dev/null); then
    echo "ERROR: $config_path: failed to parse config"
    exit 1
  fi

  # Process the node output line by line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    case "$line" in
      ERROR:*)
        echo "${line#ERROR:}"
        exit 1
        ;;
      WARNING:*)
        echo "${line#WARNING:}"
        ;;
      CONFIG_AGENT_COMMAND=*)       CONFIG_AGENT_COMMAND="${line#CONFIG_AGENT_COMMAND=}" ;;
      CONFIG_FEEDBACK_COMMANDS=*)   CONFIG_FEEDBACK_COMMANDS="${line#CONFIG_FEEDBACK_COMMANDS=}" ;;
      CONFIG_BASE_BRANCH=*)         CONFIG_BASE_BRANCH="${line#CONFIG_BASE_BRANCH=}" ;;
      CONFIG_MAX_STUCK=*)           CONFIG_MAX_STUCK="${line#CONFIG_MAX_STUCK=}" ;;
      CONFIG_MODE=*)                CONFIG_MODE="${line#CONFIG_MODE=}" ;;
      CONFIG_ISSUE_SOURCE=*)        CONFIG_ISSUE_SOURCE="${line#CONFIG_ISSUE_SOURCE=}" ;;
      CONFIG_ISSUE_LABEL=*)         CONFIG_ISSUE_LABEL="${line#CONFIG_ISSUE_LABEL=}" ;;
      CONFIG_ISSUE_IN_PROGRESS_LABEL=*) CONFIG_ISSUE_IN_PROGRESS_LABEL="${line#CONFIG_ISSUE_IN_PROGRESS_LABEL=}" ;;
      CONFIG_ISSUE_REPO=*)          CONFIG_ISSUE_REPO="${line#CONFIG_ISSUE_REPO=}" ;;
      CONFIG_ISSUE_COMMENT_PROGRESS=*) CONFIG_ISSUE_COMMENT_PROGRESS="${line#CONFIG_ISSUE_COMMENT_PROGRESS=}" ;;
      CONFIG_TURN_TIMEOUT=*)        CONFIG_TURN_TIMEOUT="${line#CONFIG_TURN_TIMEOUT=}" ;;
      CONFIG_PROMPT_MODE=*)         CONFIG_PROMPT_MODE="${line#CONFIG_PROMPT_MODE=}" ;;
      CONFIG_CONTINUOUS=*)          CONFIG_CONTINUOUS="${line#CONFIG_CONTINUOUS=}" ;;
      CONFIG_AUTO_COMMIT=*)         CONFIG_AUTO_COMMIT="${line#CONFIG_AUTO_COMMIT=}" ;;
      CONFIG_TURNS=*)               CONFIG_TURNS="${line#CONFIG_TURNS=}" ;;
      CONFIG_MAX_LEARNINGS=*)       CONFIG_MAX_LEARNINGS="${line#CONFIG_MAX_LEARNINGS=}" ;;
      CONFIG_WORKSPACES_JSON=*)     CONFIG_WORKSPACES="${line#CONFIG_WORKSPACES_JSON=}" ;;
    esac
  done <<< "$node_output"
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
  if [[ -n "${CONFIG_MAX_LEARNINGS:-}" ]]; then
    MAX_LEARNINGS="$CONFIG_MAX_LEARNINGS"
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
  if [[ -n "${RALPHAI_MAX_LEARNINGS:-}" ]]; then
    validate_nonneg_int "$RALPHAI_MAX_LEARNINGS" "RALPHAI_MAX_LEARNINGS" "0 = unlimited"
    MAX_LEARNINGS="$RALPHAI_MAX_LEARNINGS"
  fi
}



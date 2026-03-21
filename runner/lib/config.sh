# config.sh — Config resolution via TypeScript.
# Sourced by ralphai.sh. Provides resolve_config() which calls the TS
# config-cli to resolve all config layers (defaults, file, env, CLI)
# in one Node.js invocation.
#
# Replaces the former load_config(), apply_config(), apply_env_overrides()
# functions. All validation is now handled by the TypeScript module.

# Fallback: compute _CONFIG_CLI from this file's location if not already set
# or if the path set by defaults.sh doesn't exist (happens when tests source
# defaults.sh without RALPHAI_LIB_DIR being set by ralphai.sh).
if [[ -z "${_CONFIG_CLI:-}" || ! -f "${_CONFIG_CLI:-}" ]]; then
  _CONFIG_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/dist/config-cli.mjs"
fi

# resolve_config [extra_args...]
# Calls the TS config-cli with CONFIG_FILE and any extra args (typically "$@"
# from cli.sh). The --shell flag makes config-cli output shell variable
# assignments (KEY='value' per line) which are eval'd directly.
# Warnings are printed to stderr by config-cli; errors cause exit 1.
resolve_config() {
  local shell_output
  # config-cli --shell writes KEY='value' lines to stdout,
  # warnings to stderr (passed through to the user).
  if ! shell_output=$(node "$_CONFIG_CLI" "$CONFIG_FILE" --shell "$@"); then
    exit 1
  fi

  eval "$shell_output"
}

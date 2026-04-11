/**
 * Per-agent verbose flag mapping.
 *
 * When the user passes `--verbose` to `ralphai run`, the executor injects
 * agent-specific flags that enable debug/verbose output. The flags differ
 * per agent CLI:
 *
 * - OpenCode:  `--print-logs --log-level DEBUG`
 * - Claude:    `--verbose`
 * - Aider:     `--verbose`
 * - Codex:     `--verbose`
 * - Gemini:    `--verbose`
 *
 * Users can override these via the `agentVerboseFlags` config key or
 * `--agent-verbose-flags=` CLI flag for custom agents or non-standard setups.
 */

import { detectAgentType } from "../show-config.ts";
import { shellSplit } from "../shell-split.ts";

// ---------------------------------------------------------------------------
// Built-in verbose flag map
// ---------------------------------------------------------------------------

/**
 * Maps detected agent type to the CLI flags that enable verbose/debug output.
 *
 * Agents not listed here (or mapped to an empty array) get no flags injected.
 */
const AGENT_VERBOSE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  opencode: ["--print-logs", "--log-level", "DEBUG"],
  claude: ["--verbose"],
  aider: ["--verbose"],
  codex: ["--verbose"],
  gemini: ["--verbose"],
  goose: [],
  kiro: [],
  amp: [],
};

// ---------------------------------------------------------------------------
// Resolve verbose flags
// ---------------------------------------------------------------------------

/**
 * Resolve the verbose flags to inject for a given agent command.
 *
 * Resolution order:
 * 1. If `configOverride` is provided (non-empty), use it (shell-split).
 * 2. Otherwise, look up the detected agent type in the built-in map.
 * 3. Return an empty array for unknown agents or agents without verbose flags.
 *
 * @param agentCommand - The full agent command string (e.g. "opencode run --agent build").
 * @param configOverride - Optional override from `agentVerboseFlags` config key.
 * @returns An array of flag strings to inject into the command.
 */
export function resolveAgentVerboseFlags(
  agentCommand: string,
  configOverride?: string,
): string[] {
  if (configOverride) {
    return shellSplit(configOverride);
  }

  const agentType = detectAgentType(agentCommand);
  const flags = AGENT_VERBOSE_FLAGS[agentType];
  return flags ? [...flags] : [];
}

/**
 * Scope CLI — thin wrapper around src/scope.ts for shell callers.
 *
 * Usage:
 *   node scope-cli.mjs <cwd> <planScope> <rootFeedbackCommands> <rootPrFeedbackCommands> [workspacesConfig]
 *
 * Writes a JSON object to stdout:
 *   { "ecosystem": "...", "packageManager": "...", "feedbackCommands": "...", "prFeedbackCommands": "...", "scopeHint": "..." }
 *
 * Exit codes:
 *   0 — success
 *   2 — usage error
 */

import { resolveScope } from "./scope.ts";

const args = process.argv.slice(2);
const [
  cwd,
  planScope,
  rootFeedbackCommands,
  rootPrFeedbackCommands,
  workspacesConfig,
] = args;

if (
  !cwd ||
  planScope === undefined ||
  rootFeedbackCommands === undefined ||
  rootPrFeedbackCommands === undefined
) {
  process.stderr.write(
    "Usage: scope-cli <cwd> <planScope> <rootFeedbackCommands> <rootPrFeedbackCommands> [workspacesConfig]\n",
  );
  process.exit(2);
}

const result = resolveScope({
  cwd,
  planScope,
  rootFeedbackCommands,
  rootPrFeedbackCommands,
  workspacesConfig,
});

process.stdout.write(JSON.stringify(result) + "\n");

/**
 * Removed command and flag guidance.
 *
 * Detects invocations of removed commands and flags, prints actionable
 * migration messages, and exits 1. This gives users with muscle memory or
 * scripts a clear path to the new API instead of a generic "unknown command".
 */

import { RESET, TEXT, DIM } from "./utils.ts";

// ---------------------------------------------------------------------------
// Removed commands
// ---------------------------------------------------------------------------

/** Message builder for removed commands. `ctx` carries optional positional args. */
type MessageBuilder = (ctx?: { prdNumber?: string }) => string;

/** Commands that have been removed, with their migration messages. */
const REMOVED_COMMANDS: Record<string, MessageBuilder> = {
  prd: (ctx) => {
    const target = ctx?.prdNumber ?? "<number>";
    return `Unknown command 'prd'. Use ${TEXT}ralphai run ${target}${RESET} instead.`;
  },
  purge: () =>
    `Unknown command 'purge'. Use ${TEXT}ralphai clean --archive${RESET} instead.`,
  teardown: () =>
    `Unknown command 'teardown'. Use ${TEXT}ralphai uninstall${RESET} instead.`,
  "backlog-dir": () =>
    `Unknown command 'backlog-dir'. Use ${TEXT}ralphai config backlog-dir${RESET} instead.`,
  check: () =>
    `Unknown command 'check'. Use ${TEXT}ralphai config --check${RESET} instead.`,
  worktree: () =>
    `Unknown command 'worktree'. Use ${TEXT}ralphai status${RESET} instead.`,
};

/**
 * If `command` is a removed command, prints the migration message to stderr
 * and exits 1. Returns `false` if the command is not removed.
 */
export function handleRemovedCommand(
  command: string,
  ctx?: { prdNumber?: string },
): boolean {
  const builder = REMOVED_COMMANDS[command];
  if (!builder) return false;
  console.error(builder(ctx));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Removed run flags
// ---------------------------------------------------------------------------

/** Flags on `ralphai run` that have been removed, with their messages. */
const REMOVED_RUN_FLAGS: {
  pattern: RegExp;
  message: string;
  buildMessage?: (arg: string) => string;
}[] = [
  {
    pattern: /^--continuous$/,
    message: `Unknown flag '--continuous'. Ralphai now drains the backlog by default. Use ${TEXT}--once${RESET} to run a single plan.`,
  },
  {
    pattern: /^--prd(?:=|$)/,
    message: `Unknown flag '--prd'. Use ${TEXT}ralphai run <number>${RESET} instead.`,
    buildMessage: (arg) => {
      const value = arg.startsWith("--prd=") ? arg.slice("--prd=".length) : "";
      const target = value || "<number>";
      return `Unknown flag '--prd'. Use ${TEXT}ralphai run ${target}${RESET} instead.`;
    },
  },
  {
    pattern: /^--issue-source(?:=|$)/,
    message: `Unknown flag '--issue-source'. Issue settings are now config-only.\n${DIM}Set 'issueSource' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
  {
    pattern: /^--issue-label(?:=|$)/,
    message: `Unknown flag '--issue-label'. Issue settings are now config-only.\n${DIM}Set 'issueLabel' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
  {
    pattern: /^--issue-in-progress-label(?:=|$)/,
    message: `Unknown flag '--issue-in-progress-label'. Issue settings are now config-only.\n${DIM}Set 'issueInProgressLabel' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
  {
    pattern: /^--issue-done-label(?:=|$)/,
    message: `Unknown flag '--issue-done-label'. Issue settings are now config-only.\n${DIM}Set 'issueDoneLabel' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
  {
    pattern: /^--issue-repo(?:=|$)/,
    message: `Unknown flag '--issue-repo'. Issue settings are now config-only.\n${DIM}Set 'issueRepo' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
  {
    pattern: /^--issue-comment-progress(?:=|$)/,
    message: `Unknown flag '--issue-comment-progress'. Issue settings are now config-only.\n${DIM}Set 'issueCommentProgress' in config.json or use ${TEXT}ralphai config${DIM} to query it.${RESET}`,
  },
];

/**
 * Check `runArgs` for removed flags. If one is found, prints the migration
 * message to stderr and exits 1. Returns `false` if no removed flag is found.
 */
export function handleRemovedRunFlags(runArgs: string[]): boolean {
  for (const arg of runArgs) {
    for (const { pattern, message, buildMessage } of REMOVED_RUN_FLAGS) {
      if (pattern.test(arg)) {
        console.error(buildMessage ? buildMessage(arg) : message);
        process.exit(1);
      }
    }
  }
  return false;
}

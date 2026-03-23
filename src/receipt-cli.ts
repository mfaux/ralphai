/**
 * Receipt CLI — thin wrapper around src/receipt.ts for shell callers.
 *
 * Usage:
 *   node receipt-cli.mjs init          <receipt-path> <source> <branch> <slug> <plan-file> <turns-budget> [worktree-path]
 *   node receipt-cli.mjs update-turn   <receipt-path>
 *   node receipt-cli.mjs update-tasks  <receipt-path> <progress-path>
 *   node receipt-cli.mjs check-source  <wip-dir> <is-worktree>
 *
 * Exit codes:
 *   0 — success (or check-source: no conflict)
 *   1 — check-source: cross-source conflict detected (error printed to stderr)
 *   2 — usage error
 */

import {
  initReceipt,
  updateReceiptTurn,
  updateReceiptTasks,
  checkReceiptSource,
} from "./receipt.ts";

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  process.stderr.write(
    "Usage: receipt-cli <init|update-turn|update-tasks|check-source> ...\n",
  );
  process.exit(2);
}

switch (command) {
  case "init": {
    const [
      ,
      receiptPath,
      source,
      branch,
      slug,
      planFile,
      turnsBudgetStr,
      worktreePath,
    ] = args;
    if (
      !receiptPath ||
      !source ||
      !branch ||
      !slug ||
      !planFile ||
      !turnsBudgetStr
    ) {
      process.stderr.write(
        "Usage: receipt-cli init <receipt-path> <source> <branch> <slug> <plan-file> <turns-budget> [worktree-path]\n",
      );
      process.exit(2);
    }
    initReceipt(receiptPath, {
      source: source as "main" | "worktree",
      branch,
      slug,
      plan_file: planFile,
      turns_budget: parseInt(turnsBudgetStr, 10),
      worktree_path: worktreePath || undefined,
    });
    break;
  }

  case "update-turn": {
    const [, receiptPath] = args;
    if (!receiptPath) {
      process.stderr.write("Usage: receipt-cli update-turn <receipt-path>\n");
      process.exit(2);
    }
    updateReceiptTurn(receiptPath);
    break;
  }

  case "update-tasks": {
    const [, receiptPath, progressPath] = args;
    if (!receiptPath || !progressPath) {
      process.stderr.write(
        "Usage: receipt-cli update-tasks <receipt-path> <progress-path>\n",
      );
      process.exit(2);
    }
    updateReceiptTasks(receiptPath, progressPath);
    break;
  }

  case "check-source": {
    const [, wipDir, isWorktreeStr] = args;
    if (!wipDir || !isWorktreeStr) {
      process.stderr.write(
        "Usage: receipt-cli check-source <wip-dir> <is-worktree>\n",
      );
      process.exit(2);
    }
    const isWorktree = isWorktreeStr === "true";
    const ok = checkReceiptSource(wipDir, isWorktree);
    if (!ok) process.exit(1);
    break;
  }

  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exit(2);
}

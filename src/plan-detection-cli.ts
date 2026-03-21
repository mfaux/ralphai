/**
 * Plan Detection CLI -- thin wrapper around src/plan-detection.ts for shell callers.
 *
 * Usage:
 *   node plan-detection-cli.mjs detect     <wip-dir> <backlog-dir> <archive-dir> [--worktree-branch=<branch>] [--dry-run]
 *   node plan-detection-cli.mjs readiness  <plan-path> <wip-dir> <backlog-dir> <archive-dir>
 *   node plan-detection-cli.mjs describe   <plan-path>
 *   node plan-detection-cli.mjs backlog    <backlog-dir>
 *   node plan-detection-cli.mjs dep-status <dep-slug> <wip-dir> <backlog-dir> <archive-dir>
 *
 * Output:
 *   detect:     JSON object with planFile, planSlug, wipDir, resumed, or {"detected":false}
 *   readiness:  "ready" or "blocked:<reasons>"
 *   describe:   first heading text (one line)
 *   backlog:    one plan path per line
 *   dep-status: "done", "pending", or "missing"
 *
 * Exit codes:
 *   0 -- success
 *   1 -- detect: no plan found (not an error, just nothing to do)
 *   2 -- usage error
 */

import {
  detectPlan,
  planReadiness,
  getPlanDescription,
  collectBacklogPlans,
  checkDependencyStatus,
} from "./plan-detection.ts";

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  process.stderr.write(
    "Usage: plan-detection-cli <detect|readiness|describe|backlog|dep-status> ...\n",
  );
  process.exit(2);
}

switch (command) {
  case "detect": {
    const [, wipDir, backlogDir, archiveDir, ...rest] = args;
    if (!wipDir || !backlogDir || !archiveDir) {
      process.stderr.write(
        "Usage: plan-detection-cli detect <wip-dir> <backlog-dir> <archive-dir> [--worktree-branch=<branch>] [--dry-run]\n",
      );
      process.exit(2);
    }

    let worktreeBranch: string | undefined;
    let dryRun = false;
    for (const arg of rest) {
      if (arg.startsWith("--worktree-branch=")) {
        worktreeBranch = arg.slice("--worktree-branch=".length);
      } else if (arg === "--dry-run") {
        dryRun = true;
      }
    }

    const result = detectPlan({
      dirs: { wipDir, backlogDir, archiveDir },
      worktreeBranch,
      dryRun,
    });

    if (result) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      process.stdout.write(JSON.stringify({ detected: false }) + "\n");
      process.exit(1);
    }
    break;
  }

  case "readiness": {
    const [, planPath, wipDir, backlogDir, archiveDir] = args;
    if (!planPath || !wipDir || !backlogDir || !archiveDir) {
      process.stderr.write(
        "Usage: plan-detection-cli readiness <plan-path> <wip-dir> <backlog-dir> <archive-dir>\n",
      );
      process.exit(2);
    }

    const result = planReadiness(planPath, { wipDir, backlogDir, archiveDir });
    if (result.ready) {
      process.stdout.write("ready\n");
    } else {
      process.stdout.write(`blocked:${result.reasons.join(",")}\n`);
    }
    break;
  }

  case "describe": {
    const [, planPath] = args;
    if (!planPath) {
      process.stderr.write("Usage: plan-detection-cli describe <plan-path>\n");
      process.exit(2);
    }
    process.stdout.write(getPlanDescription(planPath) + "\n");
    break;
  }

  case "backlog": {
    const [, backlogDir] = args;
    if (!backlogDir) {
      process.stderr.write("Usage: plan-detection-cli backlog <backlog-dir>\n");
      process.exit(2);
    }
    const plans = collectBacklogPlans(backlogDir);
    for (const p of plans) {
      process.stdout.write(p + "\n");
    }
    break;
  }

  case "dep-status": {
    const [, depSlug, wipDir, backlogDir, archiveDir] = args;
    if (!depSlug || !wipDir || !backlogDir || !archiveDir) {
      process.stderr.write(
        "Usage: plan-detection-cli dep-status <dep-slug> <wip-dir> <backlog-dir> <archive-dir>\n",
      );
      process.exit(2);
    }
    const status = checkDependencyStatus(depSlug, {
      wipDir,
      backlogDir,
      archiveDir,
    });
    process.stdout.write(status + "\n");
    break;
  }

  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exit(2);
}

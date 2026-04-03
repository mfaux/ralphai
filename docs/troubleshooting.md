# Troubleshooting

Common issues and how to resolve them.

## "My plan is stuck"

Ralphai aborts when it detects 3 consecutive iterations with no new commits (configurable via `maxStuck`). The plan stays in `pipeline/in-progress/<slug>/` so you can resume after fixing the issue.

**Steps:**

1. Check the **Learnings** section on the draft PR for repeated errors — if the agent logged the same mistake multiple times, the plan likely needs adjustment.
2. Open the progress file in `pipeline/in-progress/<slug>/progress.md` to see what the agent attempted and where it got stuck.
3. Edit the plan file in `pipeline/in-progress/<slug>/<slug>.md` — simplify the current step, add hints, or break it into smaller subtasks.
4. Resume: `ralphai run --resume`

The `--resume` flag auto-commits any dirty working tree state and continues from where the agent left off, preserving the existing progress file.

## "Agent keeps making the same mistake"

Learnings are extracted from the agent's output automatically and surfaced in the **Learnings** section of the draft PR. Ralphai also injects them into subsequent iterations as anti-repeat memory, so the agent sees past mistakes without manual intervention.

If the agent still repeats an error, add a targeted hint directly to the plan file or to `AGENTS.md` so it appears in every prompt.

## "Build/test didn't run"

The agent is instructed to run feedback commands each iteration, but the commands themselves come from your configuration.

**Check:**

1. Verify `feedbackCommands` in `config.json` lists the right commands:
   ```json
   {
     "feedbackCommands": ["pnpm build", "pnpm test", "pnpm type-check"]
   }
   ```
2. Run each command manually to confirm it works — if a command fails outside of ralphai, it will fail inside too.
3. Run `ralphai doctor` to validate your setup. It checks each feedback command and reports pass/fail.

If `feedbackCommands` is empty, `ralphai init` auto-detects commands based on your project ecosystem. For Node.js, it reads `package.json` scripts (looks for `build`, `test`, `type-check`, `typecheck`, `lint`, `format:check`). For .NET, it suggests `dotnet build` and `dotnet test`. Other ecosystems (Go, Rust, Python, Java/Kotlin) get similar defaults.

## "Wrong agent was used"

The agent CLI is configured via `agentCommand` with this precedence:

1. `--agent-command=<cmd>` CLI flag (highest priority)
2. `RALPHAI_AGENT_COMMAND` environment variable
3. `agentCommand` in `config.json`

**Check:**

- Run `ralphai run --show-config` to see the resolved value.
- Verify the first token of the command is in your `PATH` — `ralphai doctor` checks this.
- If unset, ralphai exits with: `ERROR: agentCommand is required.`

## "Plan failed on first iteration"

**Check:**

1. Run `ralphai status` to see pipeline state and any reported problems (orphaned receipts, missing worktrees).
2. Ensure the plan follows the Ralphai plan format — it needs a title, description, and implementation tasks. Install the planning skill (`npx skills add mfaux/ralphai -g`) for format guidance.
3. Verify the agent CLI is installed and working: run your `agentCommand` manually (e.g., `claude --version` or `opencode --version`).
4. Run `ralphai doctor` for a full health check of your setup.

## "ralphai run says a plan is already running in a worktree"

This is expected. `ralphai run` starts from the main repo, then hands work off to a managed worktree. If a plan is already active, Ralphai blocks conflicting starts from the main checkout and tells you which worktree owns the run.

**Options:**

- Run `ralphai status` to see the active plan and worktree state
- Resume from the main repo with `ralphai run` or `ralphai run --plan=<file>`
- Clean up abandoned finished worktrees with `ralphai worktree clean`
- Inspect `~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/receipt.txt` for the exact worktree path and branch

## "How do I stop a running agent?"

**Headless (`ralphai run`):** Press Ctrl-C in the terminal where the runner is active. The runner catches SIGINT/SIGTERM, finishes the current iteration cleanly, then exits. Work is preserved in `in-progress/<slug>/`, so you can resume later.

**From another terminal:** Use `ralphai stop` to send SIGTERM to a running plan runner:

```bash
ralphai stop             # auto-selects if only one runner is active
ralphai stop my-plan     # stop a specific plan runner by slug
ralphai stop --all       # stop all running plan runners
ralphai stop --dry-run   # preview which processes would be stopped
```

The runner handles SIGTERM gracefully, the same way it handles Ctrl-C: it finishes the current iteration, preserves all work in `in-progress/<slug>/`, and exits cleanly. No work is lost.

## "Working tree is dirty" after init

Running `ralphai run` immediately after `ralphai init` may report a dirty working tree because init modifies `.gitignore` and optionally creates `AGENTS.md`. In an interactive terminal, Ralphai will prompt you to continue anyway.

**Options:**

- **Accept the prompt** when Ralphai asks "Continue anyway?"
- **Commit the init files first:** `git add .gitignore AGENTS.md && git commit -m "chore: configure ralphai"`
- **Skip the check explicitly:** `ralphai run --allow-dirty`

## "Not inside a git repository"

Commands that operate on repo state, such as `run`, `worktree`, and `init`, require a git repository. If you run them outside one, Ralphai exits with:

```
ERROR: <command> must be run inside a git repository.
```

**Options:**

- `cd` into your repo first, then run the command
- Use `ralphai repos` to see all known repos and their paths
- Use `--repo=<name-or-path>` with read-only commands (`status`, `doctor`, `backlog-dir`, etc.) to inspect a repo from anywhere

## "Sub-issue stuck during PRD run"

When a sub-issue hits the stuck threshold during a PRD run, Ralphai skips it and moves to the next sub-issue. The PRD continues — it does not abort.

**Steps:**

1. Check the aggregate draft PR body for the stuck sub-issue checklist.
2. Inspect `progress.md` in `in-progress/<slug>/` for the stuck sub-issue to see what the agent attempted.
3. Edit the sub-issue's plan file or add hints, then re-run the PRD: `ralphai run <prd-number>`. Already-completed sub-issues are skipped on re-run.

## "PRD not detected from GitHub issue"

When `ralphai run <number>` treats your PRD as a standalone issue, the issue is missing the required label or has no sub-issues.

**Check:**

1. The issue must have the exact label `ralphai-prd`. This label is hardcoded and not configurable (unlike the intake label `ralphai`).
2. The issue must have at least one **open** sub-issue. If all sub-issues are closed, Ralphai reports "all sub-issues are already completed."
3. Run `gh issue view <number> --json labels` to verify the label is present.
4. If the label doesn't exist in your repo yet, `ralphai run --prd=<number>` auto-creates it. The positional `ralphai run <number>` form does not.

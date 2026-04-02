# Workflows

Common patterns for working with Ralphai. Each recipe shows the command and what happens.

Back to the [README](../README.md) for setup and quickstart. See the [CLI Reference](cli-reference.md) for all flags.

## Browse plans with the dashboard

```bash
ralphai
```

Running `ralphai` with no arguments in a terminal opens the interactive dashboard. The left pane lists plans grouped by state (**In progress**, **Backlog**, **Completed**). Select a plan to see its details in the right pane, with tabs for summary, plan content, progress log, and live agent output. Press **Tab** to toggle focus between panes, **Enter** to open or focus the detail pane, **c** to copy the selected repo path, and **s/p/g/o** to switch detail tabs. Use **r** to run the selected backlog plan.

This is the primary workflow for humans. Use it to browse the backlog, inspect in-progress work, and launch runs without switching commands.

## Drain the backlog

```bash
ralphai run
```

Processes all dependency-ready plans sequentially, one branch and PR per plan. When the backlog is empty, Ralphai checks for PRD sub-issues, then regular GitHub issues. Use `--once` to process a single plan and exit.

## Parallel runs

```bash
ralphai run                         # run in separate terminals
```

Each invocation creates an isolated [worktree](worktrees.md) with its own branch and draft PR. Run multiple instances in separate terminals to work on plans in parallel. Use `ralphai worktree list` to see active runs and `ralphai worktree clean` to remove completed ones.

## Test a plan without changing anything

```bash
ralphai run --dry-run
```

Previews which plan would be selected, which worktree and branch Ralphai would use, and whether it would open a draft PR. No files are moved, no branches created, no agent invoked.

## Stop a running agent

**Headless (`ralphai run`):** Press Ctrl-C in the terminal. The runner finishes the current iteration cleanly, then exits. Work is preserved in `in-progress/<slug>/`.

**From another terminal:** Use `ralphai stop` to send SIGTERM to a running plan runner. If only one runner is active, it auto-selects. Otherwise, pass the plan slug:

```bash
ralphai stop             # auto-selects if only one runner is active
ralphai stop my-plan     # stop a specific plan runner by slug
ralphai stop --all       # stop all running plan runners
ralphai stop --dry-run   # preview which processes would be stopped
```

The runner handles SIGTERM gracefully: it finishes the current iteration, preserves work in `in-progress/<slug>/`, and exits cleanly.

## Resume after editing a stuck plan

```bash
# Edit the plan or progress file in ~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/
ralphai run
```

Ralphai auto-detects in-progress work and picks up where it left off. You can also reopen the TUI (`ralphai`) to see current progress and launch a new run from there.

If the agent left uncommitted changes from a previous run, use `--resume` to auto-commit the dirty state before continuing:

```bash
ralphai run --resume
```

To skip the dirty-state check without committing (for example, right after `ralphai init`), use `--allow-dirty`:

```bash
ralphai run --allow-dirty
```

## Run overnight unattended

```bash
ralphai run
```

Drains the entire backlog on one worktree per plan and opens/updates a draft PR for each. Stuck detection (`--max-stuck`, default 3 consecutive iterations with no commits) skips runaway plans and continues to the next.

## Work on a specific plan

```bash
ralphai run --plan=dark-mode.md
```

Targets a specific backlog plan instead of letting Ralphai pick. Creates an isolated worktree with a `ralphai/dark-mode` branch.

## Manage multiple repos

```bash
ralphai repos                           # see all repos at a glance
ralphai status --repo=my-app            # check a repo without cd-ing
ralphai reset --repo=~/work/api --yes   # reset a stuck plan remotely
```

Use `ralphai repos` to list every initialized repo with plan counts. The `--repo` flag works with read-only commands like `status`, `doctor`, `reset`, `uninstall`, and `config`.

To clean up stale entries (from deleted temp dirs or old projects):

```bash
ralphai repos --clean
```

## Run headlessly

Use `ralphai run` when you want headless execution, such as automation, scripts, or quick terminal-driven runs.

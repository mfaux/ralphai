# Workflows

Common patterns for working with Ralphai. Each recipe shows the command and what happens.

Back to the [README](../README.md) for setup and quickstart. See the [CLI Reference](cli-reference.md) for all flags.

## Drain the backlog onto one branch

```bash
ralphai run --continuous
```

Processes all dependency-ready plans sequentially on a single `ralphai/<first-plan-slug>` branch. A draft PR is created after the first plan completes and updated after each subsequent plan. When the backlog is empty, Ralphai refreshes the draft PR body and leaves it in draft.

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

## Resume after editing a stuck plan

```bash
# Edit the plan or progress file in ~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/
ralphai run
```

Ralphai auto-detects in-progress work and picks up where it left off. If the agent left uncommitted changes from a previous run, use `--resume` to auto-commit the dirty state before continuing:

```bash
ralphai run --resume
```

To skip the dirty-state check without committing (for example, right after `ralphai init`), use `--allow-dirty`:

```bash
ralphai run --allow-dirty
```

## Run overnight unattended

```bash
ralphai run --continuous
```

Processes the entire backlog (`--continuous`) on one worktree branch and opens/updates a draft PR. Stuck detection (`--max-stuck`, default 3 consecutive iterations with no commits) still stops runaway plans.

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

Use `ralphai repos` to list every initialized repo with plan counts. The `--repo` flag works with read-only commands like `status`, `doctor`, `reset`, `purge`, `teardown`, and `backlog-dir`.

To clean up stale entries (from deleted temp dirs or old projects):

```bash
ralphai repos --clean
```

## Browse plans with the dashboard

```bash
ralphai
```

Running `ralphai` with no arguments in a terminal opens the interactive dashboard. The left pane lists plans grouped by state (active, queued, done). Select a plan to see its details in the right pane, with tabs for summary, plan content, progress log, and live agent output. Press **Tab** to toggle focus between panes, and **s/p/g/o** to switch detail tabs. The dashboard auto-refreshes every 3 seconds.

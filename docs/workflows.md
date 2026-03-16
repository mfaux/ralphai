# Workflows

Common patterns for working with Ralphai. Each recipe shows the command and what happens.

Back to the [README](../README.md) for setup and quickstart. See the [CLI Reference](cli-reference.md) for all flags.

## Drain the backlog onto one branch

```bash
ralphai run --continuous --pr
```

Processes all dependency-ready plans sequentially on a single `ralphai/<first-plan-slug>` branch. A draft PR is created after the first plan completes and updated after each subsequent plan. When the backlog is empty, the PR is marked ready for review.

## One PR per plan (parallel)

```bash
ralphai worktree                    # run in separate terminals
ralphai worktree --plan=auth.md     # or target specific plans
```

Each invocation creates an isolated [worktree](worktrees.md) with its own branch and PR. Run multiple instances in separate terminals to work on plans in parallel. Use `ralphai worktree list` to see active runs and `ralphai worktree clean` to remove completed ones.

## Test a plan without changing anything

```bash
ralphai run --dry-run
```

Previews which plan would be selected, what branch would be created, and which mode would be used. No files are moved, no branches created, no agent invoked.

## Limit turns for a quick test

```bash
ralphai run --turns=1
```

Runs a single turn to verify the agent understands the plan before committing to a full run. The default is 5 turns per plan.

## Resume after editing a stuck plan

```bash
# Edit the plan or progress file in .ralphai/pipeline/in-progress/<slug>/
ralphai run
```

Ralphai auto-detects in-progress work and picks up where it left off. If the agent left uncommitted changes from a previous run, use `--resume` to auto-commit the dirty state before continuing:

```bash
ralphai run --resume
```

## Run overnight unattended

```bash
ralphai run --continuous --pr --turns=0
```

Unlimited turns per plan (`--turns=0`), processes the entire backlog (`--continuous`), opens/updates a PR (`--pr`). Stuck detection (`--max-stuck`, default 3 consecutive turns with no commits) still stops runaway plans.

## Work on a specific plan

```bash
ralphai worktree --plan=dark-mode.md
```

Targets a specific backlog plan instead of letting Ralphai pick. Creates an isolated worktree with a `ralphai/dark-mode` branch.

## Leave changes uncommitted (patch mode)

```bash
git checkout -b my-feature
ralphai run --patch
```

The agent makes changes but doesn't commit. Useful for reviewing diffs before committing manually. Patch mode requires a feature branch — it refuses to run on `main`/`master`.

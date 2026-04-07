# Workflows

Common patterns for working with Ralphai. Each recipe shows the command and what happens.

Back to the [README](../README.md) for setup and quickstart. See the [CLI Reference](cli-reference.md) for all flags.

## Browse plans with the interactive menu

```bash
ralphai
```

Running `ralphai` with no arguments in a terminal opens the interactive menu. The menu is organized into groups — **START**, **MANAGE**, and **TOOLS** — with hotkeys for quick action. Use arrow keys to navigate, **Enter** to select, and **Esc** to go back from sub-screens. On wide terminals (≥120 columns), a contextual detail pane shows information about the highlighted item. Press **q** to quit.

This is the primary workflow for humans. Use it to browse the backlog, inspect pipeline state, and launch runs without switching commands.

## Drain the backlog

```bash
ralphai run
```

Processes all dependency-ready plans sequentially, one branch and PR per plan. When the backlog is empty, Ralphai checks for PRD sub-issues, then regular GitHub issues. HITL-labeled sub-issues are skipped during auto-drain. Use `--once` to process a single plan and exit.

## Work from a PRD (recommended for features)

For multi-step features, create a PRD (Product Requirements Document) on GitHub:

1. Create a GitHub issue for the feature. Label it with the PRD label (`ralphai-prd` by default, configurable via `prdLabel`).
2. Add sub-issues for each piece of work. Use GitHub's native blocking relationships for ordering.
3. Point Ralphai at the PRD:

```bash
ralphai run 42           # issue #42: detected as PRD via label, processes sub-issues
```

Ralphai creates a single worktree on a `feat/<prd-slug>` branch and processes sub-issues one at a time. Stuck sub-issues are skipped — the PRD continues to the next. Sub-issues labeled with the HITL label (`ralphai-subissue-hitl` by default) are also skipped — they require human review. Sub-issues that depend on a HITL sub-issue are skipped as blocked. When all sub-issues are done (or skipped), Ralphai opens one aggregate draft PR listing completed, stuck, HITL, and blocked items.

The interactive menu also supports PRDs: select "Pick from GitHub" (or press **g**) and PRD issues appear with their sub-issue tree.

## Run a single GitHub issue

For one-off bugs or small tasks, label a GitHub issue with `ralphai-standalone` (configurable via `standaloneLabel`) and target it directly:

```bash
ralphai run 57           # run standalone issue #57: one branch, one PR
```

Or let the drain loop auto-pull when the local backlog is empty — Ralphai checks for PRD sub-issues first, then standalone issues. Each standalone issue gets its own `feat/<slug>` branch and draft PR, the same as a local plan file.

`ralphai run <number>` uses label-driven dispatch: it reads the issue's labels to classify it as standalone, sub-issue, or PRD. Targeting a sub-issue (labeled `ralphai-subissue`) automatically discovers its parent PRD and processes through the PRD flow.

Requires `issueSource: "github"` in config and the `gh` CLI. See the [CLI Reference](cli-reference.md#issue-tracking) for all options.

## Working on HITL sub-issues

Some sub-issues require human collaboration — design decisions, manual testing, security review. Label these with `ralphai-subissue-hitl` (configurable via `issueHitlLabel`) and use the `hitl` command:

```bash
ralphai hitl 55           # open interactive session for sub-issue #55
```

Ralphai discovers the parent PRD, creates or reuses the PRD worktree, assembles a prompt from the sub-issue body, and spawns your agent interactively with full terminal pass-through. You get the agent's TUI and can collaborate directly.

On clean exit (code 0), the HITL label is removed and `done` is added. On abnormal exit (Ctrl+C, non-zero code), labels are left unchanged so you can resume later.

**Prerequisites:**

- `agentInteractiveCommand` must be configured (e.g. `opencode`, `claude`)
- The sub-issue must have a parent PRD (with the `ralphai-prd` label)

**Dry-run:**

```bash
ralphai hitl 55 --dry-run    # preview without spawning agent or touching labels
```

## Parallel runs

```bash
ralphai run                         # run in separate terminals
```

Each invocation creates an isolated [worktree](worktrees.md) with its own branch and draft PR. Run multiple instances in separate terminals to work on plans in parallel. Use `ralphai worktree list` to see active runs and `ralphai worktree clean` to remove completed ones.

## Docker sandboxing

Ralphai can run agents inside Docker containers for filesystem and network isolation. When Docker is available, it is used by default.

**Auto-detection:** When no explicit `sandbox` value is set, Ralphai probes Docker availability at startup. If Docker is running, `sandbox` defaults to `"docker"`; otherwise it falls back to `"none"`. Use `--show-config` to see the resolved value and source:

```bash
ralphai config --show-config
# sandbox = docker (source: auto-detected)
```

**Init wizard:** Running `ralphai init` prompts for Docker sandboxing. When Docker is detected, the option is pre-selected and labeled "(recommended — Docker detected)". The wizard writes `sandbox: "docker"` or `sandbox: "none"` to `config.json`.

**Explicit override:** Set `sandbox` explicitly in config, via env var, or CLI flag to override auto-detection:

```bash
ralphai run --sandbox=docker     # force Docker
ralphai run --sandbox=none       # force local execution
```

**Status indicators:** Plans running in Docker show a `docker` tag in the status display (`ralphai status`) and the interactive menu. Local execution shows no extra tag.

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

Ralphai auto-detects in-progress work and picks up where it left off. You can also reopen the interactive menu (`ralphai`) to see current progress and launch a new run from there.

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

## Run with wizard mode

**From the interactive menu:**

```
ralphai
→ press "o" or select "Run with options..." → configure run options → launch
```

Select "Run with options..." from the interactive menu (or press **o**) to open the config wizard. The flow:

1. **Config wizard** — a multiselect of run options (agent command, feedback commands, max-stuck threshold, etc.) with current values shown. Select which options to override and provide new values.
2. **Confirm** — review the run target, agent command, and feedback commands before launching.
3. **Launch** — Ralphai merges your wizard overrides and starts the run.

Press Esc at any step to return to the main menu.

**From the CLI:**

```bash
ralphai run --wizard
ralphai run -w
```

The `--wizard` flag shows the same config wizard before launching. Combine with a target for full control:

```bash
ralphai run --wizard 42          # wizard + GitHub issue 42
ralphai run -w --plan=dark-mode  # wizard + specific plan
```

## Customize GitHub labels

By default, Ralphai creates 6 GitHub labels: 3 family labels (`ralphai-standalone`, `ralphai-subissue`, `ralphai-prd`) plus 3 shared state labels (`in-progress`, `done`, `stuck`). Override the family label names in `config.json`:

```json
{
  "standaloneLabel": "ai-standalone",
  "subissueLabel": "ai-subissue",
  "prdLabel": "ai-prd"
}
```

Or via environment variables:

```bash
export RALPHAI_STANDALONE_LABEL=ai-standalone
export RALPHAI_SUBISSUE_LABEL=ai-subissue
export RALPHAI_PRD_LABEL=ai-prd
```

See the [CLI Reference](cli-reference.md#config-keys) for all config keys and their defaults.

## Move slow tests to PR-only feedback

If your E2E or integration tests are too slow to run every iteration, move them to `prFeedbackCommands`. They will only run at the completion gate — after the agent signals all tasks are done — instead of every loop iteration.

**Before** — E2E tests run every iteration, slowing the feedback loop:

```json
{
  "feedbackCommands": ["pnpm build", "pnpm test", "pnpm test:e2e"]
}
```

**After** — E2E tests run only at the completion gate:

```json
{
  "feedbackCommands": ["pnpm build", "pnpm test"],
  "prFeedbackCommands": ["pnpm test:e2e"]
}
```

Or via CLI flags:

```bash
ralphai run --feedback-commands='pnpm build,pnpm test' --pr-feedback-commands='pnpm test:e2e'
```

If a PR-tier command fails at the gate, Ralphai re-invokes the agent with the failure details so it can fix the issue before the PR is created. See [How Ralphai Works](how-ralphai-works.md#completion-gate) for details on the two-tier model.

## Speed up iteration with feedback scope

If your test suite is large and the plan only touches a specific directory, add `feedback-scope` frontmatter to the plan. The agent prompt will include a scope hint that suggests running targeted tests for faster intermediate checks:

```md
---
feedback-scope: src/components
---
```

With this set, the agent prompt suggests commands like `bun test src/components/` for quick iteration during development, while still advising the agent to run the full feedback suite before signaling COMPLETE.

If you don't set `feedback-scope`, Ralphai tries to infer it automatically from the `## Relevant Files` section in the plan. When neither is available, no scope hint appears and behavior is unchanged.

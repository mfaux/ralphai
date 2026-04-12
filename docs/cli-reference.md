# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command        | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `init`         | Set up Ralphai in your project (configure agent and feedback commands) |
| `run`          | Create or reuse a worktree and run the next plan                       |
| `hitl`         | Open interactive agent session for a HITL sub-issue                    |
| `status`       | Show pipeline and worktree status                                      |
| `stop`         | Stop running plan runners by sending SIGTERM                           |
| `reset`        | Reset in-progress plans and clean up                                   |
| `clean`        | Remove archived plans and orphaned worktrees                           |
| `repos`        | List all known repos with pipeline summaries                           |
| `doctor`       | Check your Ralphai setup for problems                                  |
| `config`       | Query resolved configuration, keys, or capabilities                    |
| `update [tag]` | Update Ralphai to the latest (or specified) version                    |
| `uninstall`    | Remove Ralphai from this project (or `--global` to remove all state)   |

## Global Options

```
--help, -h              Show help
--version, -v           Show version
--no-color              Disable colored output (also respects NO_COLOR env var)
--repo=<name-or-path>   Target a different repo by name or path (see below)
```

## `--repo` Flag

The `--repo` flag lets you run read-only commands against a different repo without changing directories. Pass a repo name, as shown by `ralphai repos`, or an absolute or relative path.

```bash
ralphai status --repo=my-app
ralphai doctor --repo=~/work/api
ralphai config backlog-dir --repo=my-app
```

Works with: `status`, `stop`, `reset`, `clean`, `uninstall`, `doctor`, `config`.

Blocked for: `run`, `init`.

## Interactive Menu (TUI)

Running `ralphai` with no subcommand in a TTY launches the interactive menu. Browse plans, manage the pipeline, and launch runs without leaving the TUI.

The menu is organized into three groups:

- **START** — Run next plan, pick from backlog, pick from GitHub, run with options
- **MANAGE** — Resume stalled, stop running, reset plan, view pipeline status
- **TOOLS** — Doctor, clean worktrees, settings, quit

### Navigation

| Key           | Action                                           |
| ------------- | ------------------------------------------------ |
| `Up` / `Down` | Move cursor between menu items                   |
| `Enter`       | Select the highlighted item                      |
| `Esc`         | Go back from a sub-screen to the previous screen |
| `Ctrl+C`      | Exit the TUI (terminal state is always restored) |

### Hotkeys

Each menu item has a single-key hotkey that fires the action immediately:

| Key | Action              | Key | Action               |
| --- | ------------------- | --- | -------------------- |
| `n` | Run next plan       | `s` | Stop running plan    |
| `b` | Pick from backlog   | `e` | Reset plan           |
| `g` | Pick from GitHub    | `p` | View pipeline status |
| `o` | Run with options    | `d` | Doctor               |
| `r` | Resume stalled plan | `c` | Clean worktrees      |
| `q` | Quit                |     |                      |

### Detail pane

On wide terminals (≥120 columns), a contextual detail pane appears alongside the menu. It shows information relevant to the currently highlighted item — pipeline summary for run actions, plan counts for backlog/GitHub items, config values with sources for settings. On narrower terminals, only the menu is shown.

### Sub-screens

Some menu actions open sub-screens instead of exiting the TUI:

- **Pick from backlog** — list of backlog plans to select from
- **Pick from GitHub** — list of open GitHub issues (standalone + PRD)
- **Run with options** — config wizard to override run options before launch
- **Confirm** — review run details (target, agent, feedback commands) before launching
- **Stop / Reset / Status / Doctor / Clean** — inline sub-screens for pipeline management

Press `Esc` to return from any sub-screen to the main menu.

### Empty state

When the pipeline is completely empty (no backlog, in-progress, or completed plans), the menu shows hints guiding you to add plans to `./backlog/` or run `ralphai init`.

### Color and accessibility

The TUI honors the `NO_COLOR` env var and `--no-color` flag — all ANSI color codes are disabled when set. Color conventions: bold for group headers, dim for disabled items and hints, `❯` cursor indicator for the current selection.

### Terminal safety

The TUI installs cleanup handlers for SIGINT, SIGTERM, uncaught exceptions, and unhandled rejections. The terminal is always restored to its original state (raw mode disabled, cursor visible) before exit, even on crashes.

### Non-TTY fallback

In non-TTY environments (piped output, CI), `ralphai` prints the version header and help text instead of launching the TUI.

## Init

```
--yes, -y              Skip prompts; auto-detect agent (Claude Code -> OpenCode -> others)
--force                Re-scaffold from scratch
--agent-command=CMD    Set the agent command
```

In monorepo projects, `init` detects workspace packages from `pnpm-workspace.yaml`, `package.json` `workspaces`, or `.sln` files for .NET projects. In mixed repos, workspaces from all ecosystems are merged. Both modes display workspace info without adding config, and feedback commands are auto-filtered by scope at runtime.

GitHub Issues integration is enabled by default during `init` (both interactive and `--yes`). To use a different issue tracker, decline the prompt in interactive mode or set `issue.source` to `"none"` in `config.json` after init.

## Run

`ralphai run [<issue-number>]` is the only execution entrypoint. It always works through a managed git worktree.

Pass a GitHub issue number to target a specific issue or PRD directly. Without an argument, Ralphai picks from the local backlog (or pulls from GitHub when the backlog is empty).

Use it for headless execution, automation, or when you want to kick off work directly from the terminal without opening the dashboard.

What it does:

1. Picks a plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on a `<type>/<slug>` branch (e.g. `feat/add-dark-mode`)
3. Runs the agent inside that worktree
4. Commits and pushes the branch
5. Opens or updates a draft PR when `gh` is available

```
<issue-number>                       Target a GitHub issue or PRD by number
--prd=<number>                       Explicitly target a PRD issue (alternative to positional arg)
--dry-run, -n                        Preview what would happen without changing anything
--wizard, -w                         Interactively configure run options before starting
--resume, -r                         Commit dirty state and continue
--allow-dirty                        Skip the clean working tree check
--plan=<file>                        Target a specific backlog plan (default: auto-detect)
--tags=<list>                        Comma-separated tags to filter plans (OR semantics)
--agent-command=<command>            Override agent CLI command
--agent-setup-command=<command>      Command to run in worktree after creation (e.g. 'bun install')
--hooks-feedback=<list>              Comma-separated loop-tier feedback commands
--hooks-pr-feedback=<list>           Comma-separated PR-tier feedback commands
--hooks-before-run=<cmd>             Hook to run before each plan's iteration loop
--hooks-after-run=<cmd>              Hook to run after each plan completes
--hooks-feedback-timeout=<sec>       Timeout per feedback command at the gate (default: 300)
--base-branch=<branch>               Override base branch (default: main)
--drain                              Keep processing eligible work until none remains
--gate-max-stuck=<n>                 Stuck threshold before abort (default: 3)
--gate-max-rejections=<n>            Max gate rejections before force-accept (default: 2, 0 = never)
--gate-max-iterations=<n>            Max runner iterations before stuck (default: 0 = unlimited)
--gate-review-max-files=<n>          Max files in review-pass prompt (default: 25)
--gate-iteration-timeout=<sec>       Timeout per agent invocation (default: 0 = no timeout)
--gate-validators=<list>             Comma-separated validator commands (run at gate after feedback)
--gate-review                        Enable review pass after completion (default)
--gate-no-review                     Disable review pass after completion
--sandbox=<mode>                     Execution sandbox mode: 'none' or 'docker' (default: auto-detected)
--docker-image=<image>               Override Docker image (default: auto-resolve from agent name)
--docker-mounts=<csv>                Extra bind mounts for Docker sandbox (comma-separated)
--docker-env-vars=<csv>              Extra env vars to forward into Docker sandbox (comma-separated)
--prompt-verbose                     Enable verbose mode (full unabridged agent output; default: concise)
--prompt-preamble=<text>             Override default preamble (use @path to read from file)
--prompt-learnings                   Enable learnings extraction (default: on)
--no-prompt-learnings                Disable learnings extraction, prompt mandate, and PR section
--prompt-commit-style=<style>        Commit style: 'conventional' (default) or 'none'
--pr-draft                           Create draft PRs (default: on)
--no-pr-draft                        Create ready-for-review PRs instead of drafts
--git-branch-prefix=<prefix>         Override branch prefix (e.g. 'ralphai/' produces ralphai/<slug>)
--issue-hitl-label=<label>           Label marking sub-issues as requiring human interaction
--show-config                        Print resolved settings and exit
```

### Wizard Mode

`--wizard` (or `-w`) opens an interactive multi-select before the run starts, letting you override config options (agent command, setup command, feedback commands, PR feedback commands, base branch, max stuck, iteration timeout, sandbox). Each option shows its current value and source (default, auto-detected, config file, env var, or CLI flag).

Wizard overrides are injected as synthetic CLI flags. Explicit flags passed alongside `--wizard` take precedence (last-wins):

```bash
ralphai run --wizard                         # choose options interactively
ralphai run -w 42                            # wizard + issue target
ralphai run --wizard --agent-command='X'     # wizard, but --agent-command='X' wins
ralphai run --wizard --dry-run               # wizard then dry-run preview
```

Requires an interactive terminal (TTY). In non-TTY contexts, prints an error with guidance and exits.

### Drain Mode

By default, `ralphai run` processes a single eligible work unit and exits. Use `--drain` to keep processing plans sequentially, one branch and PR per plan, until the queue is empty.

- Each plan gets its own worktree branch and draft PR
- Stuck plans are skipped and reported in the exit summary
- When the backlog is empty, Ralphai checks for PRD issues, then regular issues
- Exit summary reports "Completed N, skipped M (stuck)" with stuck slugs; HITL and blocked-by-HITL sub-issues are also reported

### Issue Tracking

Issue tracking is configured via `config.json` or environment variables (see [Configuration](#configuration)). Set `issue.source` to `"github"` to enable pulling plans from GitHub issues when the backlog is empty.

#### PRDs (Product Requirements Documents)

For multi-step features, create a GitHub issue labeled with the PRD label (`ralphai-prd` by default, configurable via `issue.prdLabel`) with sub-issues.

```bash
ralphai run 42           # auto-detects PRD label, processes sub-issues sequentially
ralphai run --prd=42     # explicitly target a PRD (errors if label is missing)
```

PRD behavior:

- All sub-issues run on a single `feat/<prd-slug>` branch in one worktree
- Sub-issues are processed in GitHub API order; dependencies via blocking relationships are respected
- Per-sub-issue PRs are suppressed; one aggregate draft PR is opened at the end
- Stuck sub-issues are skipped and listed in the PR body; the PRD continues to the next
- HITL sub-issues (labeled with `issue.hitlLabel`, default `ralphai-subissue-hitl`) and sub-issues blocked by HITL dependencies are skipped; the PRD continues to the next eligible sub-issue
- The aggregate PR title uses `feat: <PRD title>` and includes completed/stuck/HITL checklists

The `ralphai run <number>` form uses label-driven dispatch: it reads the issue's labels to classify it as standalone (`ralphai-standalone`), sub-issue (`ralphai-subissue`), or PRD (`ralphai-prd`). Sub-issues automatically discover their parent PRD and process through the PRD flow. Issues with no recognized label produce an error with guidance. The old unified `ralphai` label is not recognized.

#### Standalone Issues

Label issues with the configured standalone intake label (`ralphai-standalone` by default). Each gets its own `feat/<slug>` branch and draft PR, the same as a local plan file.

#### Sub-Issues

Label issues with `ralphai-subissue` and ensure they have a parent PRD relationship on GitHub. Ralphai discovers the parent PRD and processes the sub-issue through the PRD flow on the parent's shared branch. Validation catches misconfigurations: orphaned sub-issues or parents missing the PRD label are skipped with a warning.

## Hitl

```
ralphai hitl <issue-number> [--dry-run]
```

Open an interactive agent session for a HITL (human-in-the-loop) sub-issue. This is the primary interface for humans to collaborate with the agent on complex tasks that can't be fully automated.

```
<issue-number>        GitHub issue number of the HITL sub-issue
--dry-run, -n         Preview what would happen without spawning the agent
```

**Requires:** `agent.interactiveCommand` must be configured (in `config.json` or via `RALPHAI_AGENT_INTERACTIVE_COMMAND` env var).

Orchestration flow:

1. Discovers the parent PRD via the sub-issue's parent relationship
2. Creates or reuses the PRD's worktree (same branch as `ralphai run`)
3. Assembles a prompt from the sub-issue body
4. Spawns the agent interactively with full terminal pass-through (`stdio: "inherit"`)

Label management on exit:

- **Clean exit (code 0):** Removes the `ralphai-subissue-hitl` label and adds `done`
- **Abnormal exit (non-zero, Ctrl+C):** Leaves all labels unchanged

Validation errors with descriptive messages when:

- The issue has no parent
- The parent lacks the PRD label
- `agent.interactiveCommand` is not configured

## Clean

```
ralphai clean [--worktrees] [--archive] [--yes]
```

Unified cleanup command that removes archived plans and orphaned worktrees. By default both are cleaned; use flags to scope to one type.

```
--worktrees   Clean only orphaned worktrees
--archive     Clean only archived plans
--yes, -y     Skip confirmation prompt
```

Behavior:

- **No flags:** Cleans both archived plans from `pipeline/out/` and orphaned worktrees
- **`--archive`:** Only removes archived plans (equivalent to `ralphai purge`)
- **`--worktrees`:** Only removes orphaned worktrees
- **Nothing to clean:** Prints "Nothing to clean" and exits 0

## Stop

```
ralphai stop [<slug>] [--all] [--dry-run]
```

Stops running plan runners by sending SIGTERM to their processes.

```
--all             Stop all running plan runners
--dry-run, -n     Preview which processes would be stopped without sending signals
```

Behavior:

- **No arguments, one runner active:** Auto-selects and stops it
- **No arguments, multiple runners:** Prints an error listing active runners and asks you to specify a slug or use `--all`
- **`<slug>`:** Stops the runner for the named plan
- **`--all`:** Stops all running plan runners
- **`--dry-run`:** Prints what would happen without sending any signals

The runner handles SIGTERM gracefully: it finishes the current iteration, preserves work in `in-progress/<slug>/`, and exits cleanly.

## Reset

```
--yes, -y         Skip confirmation prompt
```

Resets pipeline state so you can start fresh:

- **Local plans** -> moves plan files from `in-progress/<slug>/` back to `backlog/` as flat `.md` files
- **GitHub-sourced plans** -> removes plan files from `in-progress/<slug>/` entirely (they are re-pulled from GitHub on the next `ralphai run`, picking up any edits made to the issue since the last pull)
- **Artifacts** -> deletes `progress.md` and `receipt.txt` for each in-progress plan
- **Worktrees** -> removes Ralphai-managed worktrees and force-deletes their branches
- **GitHub labels** -> for plans sourced from GitHub issues, restores the intake label and removes the in-progress label (best-effort)

Use `reset` when a run is stuck and you want to re-queue the plan, or when you want to abandon in-progress work and start over. For GitHub-sourced plans, this is particularly useful because the re-pull on the next run captures any edits you made to the issue body after the original pull.

## Doctor

`ralphai doctor` validates your setup with these checks:

1. Config exists in global state
2. `config.json` is valid JSON with recognized keys
3. Git repository detected
4. Working tree is clean
5. Base branch exists
6. Agent command is in `PATH`
7. Feedback commands run successfully
8. Backlog has plans
9. No orphaned receipts in `in-progress/`

When a `workspaces` config key exists, doctor also validates per-workspace feedback commands. Workspace failures produce warnings, not hard errors.

## Config

`ralphai config` is the unified entry point for querying configuration. It consolidates `run --show-config`, `backlog-dir`, and `check` into a single subcommand.

```
ralphai config [<key>] [--check=<capability>]
```

### Modes

**Bare config** — prints the fully resolved configuration (equivalent to `run --show-config`):

```bash
ralphai config
```

**Key query** — prints a specific config value to stdout:

```bash
ralphai config backlog-dir
# ~/.ralphai/repos/<repo-id>/pipeline/backlog
```

| Key           | Description                            |
| ------------- | -------------------------------------- |
| `backlog-dir` | Absolute path to the backlog directory |

**Capability check** — validates whether a capability is configured (same behavior as `ralphai check --capability`):

```bash
ralphai config --check=issues
```

```
--check=<capability>   Check if a capability is enabled (repeatable)
```

**Capability check output:**

| Condition               | stdout                                                                | Exit code |
| ----------------------- | --------------------------------------------------------------------- | --------- |
| All capabilities met    | `configured (issues: github)`                                         | 0         |
| Capability not met      | `configured, but missing capability: issues (issue.source is "none")` | 1         |
| Not configured          | `not configured — run ralphai init`                                   | 1         |
| Unknown capability name | `unknown capability: "foo" (supported: issues)`                       | 1         |

Supported capabilities:

| Name     | Checks                                 |
| -------- | -------------------------------------- |
| `issues` | `issue.source` is `"github"` in config |

Multiple `--capability` flags can be combined; all must pass for exit 0.

### Error handling

On a non-initialized repo, `ralphai config` and `ralphai config <key>` print an error suggesting `ralphai init` and exit 1.

## Uninstall

```
--global          Remove all global state (~/.ralphai) instead of just this repo
--yes, -y         Skip confirmation prompt
```

By default, `ralphai uninstall` removes only the current repo's state directory at `~/.ralphai/repos/<id>/`.

With `--global`, it removes the entire `~/.ralphai/` directory (all repos) and prints the command to uninstall the CLI binary. When active plans exist in other repos, a warning lists affected repos before confirmation.

## Repos

```
--clean           Remove stale entries (dead paths with no plans)
```

Lists all known repos with pipeline summaries showing backlog, in-progress, and completed plan counts.

```bash
ralphai repos
ralphai repos --clean
```

A repo entry is stale when its stored `repoPath` no longer exists on disk and its pipeline is empty.

## Configuration

Settings resolve in this order: **CLI flags > env vars > `config.json` > defaults**. See [Hooks, Gates, and Prompt Controls](hooks.md) for the full config reference with examples.

### Environment Variables

| Env Var                             | Config Key                 |
| ----------------------------------- | -------------------------- |
| `RALPHAI_AGENT_COMMAND`             | `agent.command`            |
| `RALPHAI_AGENT_SETUP_COMMAND`       | `agent.setupCommand`       |
| `RALPHAI_AGENT_INTERACTIVE_COMMAND` | `agent.interactiveCommand` |
| `RALPHAI_HOOKS_FEEDBACK`            | `hooks.feedback`           |
| `RALPHAI_HOOKS_PR_FEEDBACK`         | `hooks.prFeedback`         |
| `RALPHAI_HOOKS_BEFORE_RUN`          | `hooks.beforeRun`          |
| `RALPHAI_HOOKS_AFTER_RUN`           | `hooks.afterRun`           |
| `RALPHAI_HOOKS_FEEDBACK_TIMEOUT`    | `hooks.feedbackTimeout`    |
| `RALPHAI_BASE_BRANCH`               | `baseBranch`               |
| `RALPHAI_GATE_REVIEW`               | `gate.review`              |
| `RALPHAI_PROMPT_VERBOSE`            | `prompt.verbose`           |
| `RALPHAI_PROMPT_PREAMBLE`           | `prompt.preamble`          |
| `RALPHAI_PROMPT_LEARNINGS`          | `prompt.learnings`         |
| `RALPHAI_PROMPT_COMMIT_STYLE`       | `prompt.commitStyle`       |
| `RALPHAI_GATE_MAX_STUCK`            | `gate.maxStuck`            |
| `RALPHAI_GATE_ITERATION_TIMEOUT`    | `gate.iterationTimeout`    |
| `RALPHAI_GATE_MAX_REJECTIONS`       | `gate.maxRejections`       |
| `RALPHAI_GATE_MAX_ITERATIONS`       | `gate.maxIterations`       |
| `RALPHAI_GATE_REVIEW_MAX_FILES`     | `gate.reviewMaxFiles`      |
| `RALPHAI_GATE_VALIDATORS`           | `gate.validators`          |
| `RALPHAI_PR_DRAFT`                  | `pr.draft`                 |
| `RALPHAI_GIT_BRANCH_PREFIX`         | `git.branchPrefix`         |
| `RALPHAI_NO_UPDATE_CHECK`           | _(none)_                   |
| `RALPHAI_ISSUE_SOURCE`              | `issue.source`             |
| `RALPHAI_ISSUE_STANDALONE_LABEL`    | `issue.standaloneLabel`    |
| `RALPHAI_ISSUE_SUBISSUE_LABEL`      | `issue.subissueLabel`      |
| `RALPHAI_ISSUE_PRD_LABEL`           | `issue.prdLabel`           |
| `RALPHAI_ISSUE_REPO`                | `issue.repo`               |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`    | `issue.commentProgress`    |
| `RALPHAI_ISSUE_HITL_LABEL`          | `issue.hitlLabel`          |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL`   | `issue.inProgressLabel`    |
| `RALPHAI_ISSUE_DONE_LABEL`          | `issue.doneLabel`          |
| `RALPHAI_ISSUE_STUCK_LABEL`         | `issue.stuckLabel`         |
| `RALPHAI_SANDBOX`                   | `sandbox`                  |
| `RALPHAI_DOCKER_IMAGE`              | `dockerImage`              |
| `RALPHAI_DOCKER_MOUNTS`             | `dockerMounts`             |
| `RALPHAI_DOCKER_ENV_VARS`           | `dockerEnvVars`            |

### Config Keys

Config keys are organized into nested groups: `agent`, `hooks`, `gate`, `prompt`, `pr`, `git`, `issue`, plus flat top-level keys. See [Hooks, Gates, and Prompt Controls](hooks.md#config-reference) for the complete table with defaults, env vars, CLI flags, and descriptions.

Example `config.json`:

```json
{
  "agent": { "command": "claude -p" },
  "hooks": { "feedback": "pnpm build,pnpm test" },
  "gate": { "maxStuck": 3, "review": true },
  "prompt": { "verbose": false },
  "pr": { "draft": true },
  "git": { "branchPrefix": "" },
  "issue": { "source": "github" },
  "baseBranch": "main"
}
```

### Plan Frontmatter Fields

Plan files support these YAML frontmatter fields:

| Field            | Description                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scope`          | Monorepo package path (e.g. `packages/web`). Rewrites feedback commands to target the scoped package.                   |
| `feedback-scope` | Directory path for narrowing feedback focus (e.g. `src/components`). Overrides auto-detection from `## Relevant Files`. |
| `depends-on`     | List of plan slugs that must complete before this plan runs.                                                            |
| `source`         | Origin of the plan (`github` or `manual`).                                                                              |
| `issue`          | GitHub issue number associated with this plan.                                                                          |
| `issue-url`      | Full URL of the GitHub issue.                                                                                           |
| `prd`            | Parent PRD issue number.                                                                                                |
| `priority`       | Numeric priority (lower = runs sooner). Plans without `priority` get implicit `0`.                                      |
| `tags`           | Tags for filtering plans (e.g. `[frontend, auth]`). Use `--tags=frontend` to run only matching plans. OR semantics.     |

See [Hooks, Gates, and Prompt Controls](hooks.md#plan-frontmatter-reference) for the full reference including `## Agent Instructions`.

### Workspaces

The `workspaces` key in `config.json` provides per-package overrides for monorepo projects. Each key is a relative path matching a plan's `scope` frontmatter value. Overridable fields: `feedbackCommands`, `prFeedbackCommands`, `validators`, `beforeRun`, `preamble`.

```json
{
  "hooks": {
    "feedback": "pnpm build,pnpm test",
    "prFeedback": "pnpm test:e2e"
  },
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"],
      "prFeedbackCommands": ["pnpm --filter web test:e2e"]
    },
    "packages/api": {
      "feedbackCommands": ["pnpm --filter api build"]
    }
  }
}
```

When a plan declares `scope: packages/web`, Ralphai first checks for a matching `workspaces` entry. If none exists, it derives scoped commands automatically. Workspace entries that override `feedbackCommands` but omit `prFeedbackCommands` inherit the root-level `hooks.prFeedback` unchanged.

- **Node.js** -> uses the package manager's workspace filter
- **C# / .NET** -> appends the scope path to dotnet commands
- **Other ecosystems** -> passes commands through unchanged

See [Hooks, Gates, and Prompt Controls](hooks.md#workspace-overrides) for the full workspace override reference.

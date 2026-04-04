# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command        | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `init`         | Set up Ralphai in your project (configure agent and feedback commands) |
| `run`          | Create or reuse a worktree and run the next plan                       |
| `status`       | Show pipeline and worktree status                                      |
| `stop`         | Stop running plan runners by sending SIGTERM                           |
| `reset`        | Move in-progress plans back to backlog and clean up                    |
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

## Interactive Dashboard

Running `ralphai` with no subcommand in a TTY launches the interactive dashboard. Browse plans here, inspect progress, and launch runs without leaving the TUI.

Navigation:

- `1`, `2`, `3` focus the repo bar, pipeline, or detail pane
- `Tab` and `Shift+Tab` cycle between panes
- `Up` and `Down` move within the focused pane
- `Enter` opens detail, focuses the detail pane, or selects the current dropdown item
- `Esc` closes overlays or returns to the previous view
- `q` quits the dashboard from repo or pipeline focus

Detail tabs:

- `s` summary
- `p` plan
- `g` progress
- `o` output
- `c` copies the selected repo path

Actions:

- `a` opens the action menu for the selected plan
- `r` runs the selected backlog plan
- `R` resets an in-progress plan to backlog
- `P` purges a completed plan archive
- `/` opens the filter bar
- `?` opens keyboard help

The dashboard auto-refreshes every 3 seconds. In non-TTY environments, `ralphai` shows help text instead.

## Init

```
--yes, -y              Skip prompts; auto-detect agent (Claude Code -> OpenCode -> others)
--force                Re-scaffold from scratch
--agent-command=CMD    Set the agent command
```

In monorepo projects, `init` detects workspace packages from `pnpm-workspace.yaml`, `package.json` `workspaces`, or `.sln` files for .NET projects. In mixed repos, workspaces from all ecosystems are merged. Both modes display workspace info without adding config, and feedback commands are auto-filtered by scope at runtime.

GitHub Issues integration is enabled by default during `init` (both interactive and `--yes`). To use a different issue tracker, decline the prompt in interactive mode or set `issueSource` to `"none"` in `config.json` after init.

## Run

`ralphai run [<issue-number>]` is the only execution entrypoint. It always works through a managed git worktree.

Pass a GitHub issue number to target a specific issue or PRD directly. Without an argument, Ralphai picks from the local backlog (or pulls from GitHub when the backlog is empty).

Use it for headless execution, automation, or when you want to kick off work directly from the terminal without opening the dashboard.

What it does:

1. Picks a plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on `ralphai/<slug>` (or `feat/<prd-slug>` for PRD-driven runs)
3. Runs the agent inside that worktree
4. Commits and pushes the branch
5. Opens or updates a draft PR when `gh` is available

```
<issue-number>                    Target a GitHub issue or PRD by number
--prd=<number>                    Explicitly target a PRD issue (alternative to positional arg)
--dry-run, -n                     Preview what would happen without changing anything
--wizard, -w                      Interactively configure run options before starting
--resume, -r                      Auto-commit dirty state and continue
--allow-dirty                     Skip the clean working tree check
--plan=<file>                     Target a specific backlog plan (default: auto-detect)
--agent-command=<command>         Override agent CLI command
--setup-command=<command>         Command to run in worktree after creation (e.g. 'bun install')
--feedback-commands=<list>        Comma-separated feedback commands
--base-branch=<branch>            Override base branch (default: main)
--once                            Process a single work unit then exit
--max-stuck=<n>                   Stuck threshold before abort (default: 3)
--iteration-timeout=<seconds>     Timeout per agent invocation (default: 0 = no timeout)
--auto-commit                     Enable auto-commit recovery snapshots
--no-auto-commit                  Disable auto-commit recovery snapshots (default)
--show-config                     Print resolved settings and exit
```

### Wizard Mode

`--wizard` (or `-w`) opens an interactive multi-select before the run starts, letting you override any of the 7 config options (agent command, setup command, feedback commands, base branch, max stuck, iteration timeout, auto-commit). Each option shows its current value and source (default, config file, env var, or CLI flag).

Wizard overrides are injected as synthetic CLI flags. Explicit flags passed alongside `--wizard` take precedence (last-wins):

```bash
ralphai run --wizard                         # choose options interactively
ralphai run -w 42                            # wizard + issue target
ralphai run --wizard --agent-command='X'     # wizard, but --agent-command='X' wins
ralphai run --wizard --dry-run               # wizard then dry-run preview
```

Requires an interactive terminal (TTY). In non-TTY contexts, prints an error with guidance and exits.

### Drain Mode

By default, `ralphai run` drains the backlog — processing plans sequentially, one branch and PR per plan, until the queue is empty. Use `--once` to process a single work unit and exit.

- Each plan gets its own worktree branch and draft PR
- Stuck plans are skipped and reported in the exit summary
- When the backlog is empty, Ralphai checks for PRD issues, then regular issues
- Exit summary reports "Completed N, skipped M (stuck)" with stuck slugs

### Issue Tracking

Issue tracking is configured via `config.json` or environment variables (see [Configuration](#configuration)). Set `issueSource` to `"github"` to enable pulling plans from GitHub issues when the backlog is empty.

#### PRDs (Product Requirements Documents)

For multi-step features, create a GitHub issue labeled with the PRD label (`ralphai-prd` by default, configurable via `prdLabel`) with sub-issues.

```bash
ralphai run 42           # auto-detects PRD label, processes sub-issues sequentially
ralphai run --prd=42     # explicitly target a PRD (errors if label is missing)
```

PRD behavior:

- All sub-issues run on a single `feat/<prd-slug>` branch in one worktree
- Sub-issues are processed in GitHub API order; dependencies via blocking relationships are respected
- Per-sub-issue PRs are suppressed; one aggregate draft PR is opened at the end
- Stuck sub-issues are skipped and listed in the PR body; the PRD continues to the next
- The aggregate PR title uses `feat: <PRD title>` and includes completed/stuck checklists

The `ralphai run <number>` form uses label-driven dispatch: it reads the issue's labels to classify it as standalone (`ralphai-standalone`), sub-issue (`ralphai-subissue`), or PRD (`ralphai-prd`). Sub-issues automatically discover their parent PRD and process through the PRD flow. Issues with no recognized label produce an error with guidance. The old unified `ralphai` label is not recognized.

#### Standalone Issues

Label issues with the configured standalone intake label (`ralphai-standalone` by default). Each gets its own `feat/<slug>` branch and draft PR, the same as a local plan file.

#### Sub-Issues

Label issues with `ralphai-subissue` and ensure they have a parent PRD relationship on GitHub. Ralphai discovers the parent PRD and processes the sub-issue through the PRD flow on the parent's shared branch. Validation catches misconfigurations: orphaned sub-issues or parents missing the PRD label are skipped with a warning.

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
- **`--worktrees`:** Only removes orphaned worktrees (equivalent to `ralphai worktree clean`)
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

- **Plans** -> moves plan files from `in-progress/<slug>/` back to `backlog/` as flat `.md` files
- **Artifacts** -> deletes `progress.md` and `receipt.txt` for each in-progress plan
- **Worktrees** -> removes Ralphai-managed worktrees and force-deletes their branches
- **GitHub labels** -> for plans sourced from GitHub issues, restores the intake label and removes the in-progress label (best-effort)

Use `reset` when a run is stuck and you want to re-queue the plan, or when you want to abandon in-progress work and start over.

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

| Condition               | stdout                                                               | Exit code |
| ----------------------- | -------------------------------------------------------------------- | --------- |
| All capabilities met    | `configured (issues: github)`                                        | 0         |
| Capability not met      | `configured, but missing capability: issues (issueSource is "none")` | 1         |
| Not configured          | `not configured — run ralphai init`                                  | 1         |
| Unknown capability name | `unknown capability: "foo" (supported: issues)`                      | 1         |

Supported capabilities:

| Name     | Checks                                |
| -------- | ------------------------------------- |
| `issues` | `issueSource` is `"github"` in config |

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

Settings resolve in this order: **CLI flags > env vars > `config.json` > defaults**.

### Environment Variables

| Env Var                               | Config Key                |
| ------------------------------------- | ------------------------- |
| `RALPHAI_AGENT_COMMAND`               | `agentCommand`            |
| `RALPHAI_FEEDBACK_COMMANDS`           | `feedbackCommands`        |
| `RALPHAI_BASE_BRANCH`                 | `baseBranch`              |
| `RALPHAI_AUTO_COMMIT`                 | `autoCommit`              |
| `RALPHAI_MAX_STUCK`                   | `maxStuck`                |
| `RALPHAI_ITERATION_TIMEOUT`           | `iterationTimeout`        |
| `RALPHAI_NO_UPDATE_CHECK`             | _(none)_                  |
| `RALPHAI_ISSUE_SOURCE`                | `issueSource`             |
| `RALPHAI_ISSUE_LABEL`                 | `issueLabel`              |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL`     | `issueInProgressLabel`    |
| `RALPHAI_ISSUE_DONE_LABEL`            | `issueDoneLabel`          |
| `RALPHAI_ISSUE_STUCK_LABEL`           | `issueStuckLabel`         |
| `RALPHAI_ISSUE_PRD_LABEL`             | `issuePrdLabel`           |
| `RALPHAI_ISSUE_PRD_IN_PROGRESS_LABEL` | `issuePrdInProgressLabel` |
| `RALPHAI_ISSUE_PRD_DONE_LABEL`        | `issuePrdDoneLabel`       |
| `RALPHAI_ISSUE_REPO`                  | `issueRepo`               |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`      | `issueCommentProgress`    |

### Config Keys

| Key                    | Default                | Env Var                          | Description                                                          |
| ---------------------- | ---------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `agentCommand`         | _(none)_               | `RALPHAI_AGENT_COMMAND`          | CLI command to invoke the coding agent                               |
| `feedbackCommands`     | _(auto-detected)_      | `RALPHAI_FEEDBACK_COMMANDS`      | Comma-separated build/test/lint commands                             |
| `baseBranch`           | `"main"`               | `RALPHAI_BASE_BRANCH`            | Base branch for worktree creation                                    |
| `autoCommit`           | `false`                | `RALPHAI_AUTO_COMMIT`            | Enable auto-commit recovery snapshots                                |
| `maxStuck`             | `3`                    | `RALPHAI_MAX_STUCK`              | Consecutive no-commit iterations before abort                        |
| `iterationTimeout`     | `0`                    | `RALPHAI_ITERATION_TIMEOUT`      | Per-agent-invocation timeout in seconds (0 = no timeout)             |
| `issueSource`          | `"none"`               | `RALPHAI_ISSUE_SOURCE`           | Issue source (`"github"` or `"none"`); `init` defaults to `"github"` |
| `standaloneLabel`      | `"ralphai-standalone"` | `RALPHAI_STANDALONE_LABEL`       | Base name for standalone issue labels (4 states derived)             |
| `subissueLabel`        | `"ralphai-subissue"`   | `RALPHAI_SUBISSUE_LABEL`         | Base name for PRD sub-issue labels (4 states derived)                |
| `prdLabel`             | `"ralphai-prd"`        | `RALPHAI_PRD_LABEL`              | Base name for PRD parent labels (4 states derived)                   |
| `issueRepo`            | _(auto-detected)_      | `RALPHAI_ISSUE_REPO`             | GitHub `owner/repo` for issue queries                                |
| `issueCommentProgress` | `false`                | `RALPHAI_ISSUE_COMMENT_PROGRESS` | Post progress comments on GitHub issues                              |

### Workspaces

The `workspaces` key in `config.json` provides per-package feedback command overrides for monorepo projects. Each key is a relative path matching a plan's `scope` frontmatter value.

```json
{
  "feedbackCommands": ["pnpm build", "pnpm test"],
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"]
    },
    "packages/api": {
      "feedbackCommands": ["pnpm --filter api build"]
    }
  }
}
```

When a plan declares `scope: packages/web`, Ralphai first checks for a matching `workspaces` entry. If none exists, it derives scoped commands automatically.

- **Node.js** -> uses the package manager's workspace filter
- **C# / .NET** -> appends the scope path to dotnet commands
- **Other ecosystems** -> passes commands through unchanged

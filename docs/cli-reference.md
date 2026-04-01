# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command        | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `init`         | Set up Ralphai in your project (configure agent and feedback commands) |
| `run`          | Create or reuse a worktree and run the next plan                       |
| `prd`          | Run a PRD issue (shorthand for `run --prd=<number>`)                   |
| `worktree`     | Manage Ralphai worktrees (`list`, `clean`)                             |
| `status`       | Show pipeline and worktree status                                      |
| `stop`         | Stop running plan runners by sending SIGTERM                           |
| `reset`        | Move in-progress plans back to backlog and clean up                    |
| `purge`        | Delete archived artifacts from `pipeline/out/`                         |
| `clean`        | Remove archived plans and orphaned worktrees                           |
| `repos`        | List all known repos with pipeline summaries                           |
| `doctor`       | Check your Ralphai setup for problems                                  |
| `config`       | Query resolved configuration, keys, or capabilities                    |
| `check`        | Verify whether Ralphai is configured for a repo                        |
| `backlog-dir`  | Print the path to the plan backlog directory                           |
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
ralphai backlog-dir --repo=my-app
```

Works with: `status`, `stop`, `reset`, `purge`, `clean`, `uninstall`, `backlog-dir`, `doctor`, `check`, `config`.

Blocked for: `run`, `prd`, `worktree`, `init`.

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

## Run

`ralphai run` is the only execution entrypoint. It always works through a managed git worktree.

Use it for headless execution, automation, or when you want to kick off work directly from the terminal without opening the dashboard.

What it does:

1. Picks a plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on `ralphai/<slug>` (or `feat/<prd-slug>` for PRD-driven runs)
3. Runs the agent inside that worktree
4. Commits and pushes the branch
5. Opens or updates a draft PR when `gh` is available

```
--dry-run, -n                     Preview what would happen without changing anything
--resume, -r                      Auto-commit dirty state and continue
--allow-dirty                     Skip the clean working tree check
--plan=<file>                     Target a specific backlog plan (default: auto-detect)
--prd=<number>                    Run a PRD-driven session from a GitHub issue
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

### Drain Mode

By default, `ralphai run` drains the backlog — processing plans sequentially, one branch and PR per plan, until the queue is empty. Use `--once` to process a single work unit and exit.

- Each plan gets its own worktree branch and draft PR
- Stuck plans are skipped and reported in the exit summary
- When the backlog is empty, Ralphai checks for PRD issues, then regular issues
- Exit summary reports "Completed N, skipped M (stuck)" with stuck slugs

### Issue Tracking

```
--issue-source=<source>           Issue source: 'none' or 'github' (default: none)
--issue-label=<label>             Label to filter issues (default: ralphai)
--issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)
--issue-done-label=<label>       Label applied when issue is done (default: ralphai:done)
--issue-repo=<owner/repo>         Override repo for issue operations (default: auto-detect)
--issue-comment-progress=<bool>   Comment on issue during run (default: true)
```

## Prd

`ralphai prd <issue-number>` is shorthand for `ralphai run --prd=<issue-number>`. It fetches a GitHub issue, derives a branch name from the issue title, and drains its sub-issues in a managed worktree.

```bash
ralphai prd 42                                # PRD-driven drain run
ralphai prd 42 --dry-run                      # preview only
ralphai prd 42 --agent-command='claude -p'    # use Claude Code
```

All `ralphai run` flags are accepted and passed through. Must be run from the main repository (not a worktree).

## Worktree

`ralphai worktree` is now a maintenance command. It does not start runs.

```bash
ralphai worktree list
ralphai worktree clean
```

- `list` shows active Ralphai-managed worktrees (both `ralphai/` and `feat/` branches)
- `clean` removes completed or orphaned worktrees and archives any leftover receipt

Use `ralphai run` to start or resume work.

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

Use `reset` when a run is stuck and you want to re-queue the plan, or when you want to abandon in-progress work and start over.

## Purge

```
--yes, -y         Skip confirmation prompt
```

Deletes all archived plan artifacts from `pipeline/out/`.

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

See the [Check](#check) section for output format and exit codes.

### Error handling

On a non-initialized repo, `ralphai config` and `ralphai config <key>` print an error suggesting `ralphai init` and exit 1.

## Check

`ralphai check` verifies whether Ralphai is configured for the current repo. It prints a single line of plain text (no ANSI color codes) and exits 0 on success or 1 on failure.

```
--capability=<name>   Check if a specific capability is enabled (repeatable)
--repo=<name>         Check config for a different repo
```

Output (without `--capability`):

| Condition            | stdout                              | Exit code |
| -------------------- | ----------------------------------- | --------- |
| Config is valid      | `configured`                        | 0         |
| No config file       | `not configured — run ralphai init` | 1         |
| Malformed or invalid | `invalid config — <detail>`         | 1         |

Output (with `--capability`):

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

Does not require a git repository. Useful for CI scripts and setup verification.

## Uninstall

```
--global          Remove all global state (~/.ralphai) instead of just this repo
--yes, -y         Skip confirmation prompt
```

By default, `ralphai uninstall` removes only the current repo's state directory at `~/.ralphai/repos/<id>/`.

With `--global`, it removes the entire `~/.ralphai/` directory (all repos) and prints the command to uninstall the CLI binary. When active plans exist in other repos, a warning lists affected repos before confirmation.

## Backlog Dir

Prints the absolute path to the plan backlog directory for the current repository.

```bash
ralphai backlog-dir
# ~/.ralphai/repos/<repo-id>/pipeline/backlog
```

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

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`             | `baseBranch`           |
| `RALPHAI_AUTO_COMMIT`             | `autoCommit`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPHAI_NO_UPDATE_CHECK`         | _(none)_               |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_DONE_LABEL`        | `issueDoneLabel`       |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

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

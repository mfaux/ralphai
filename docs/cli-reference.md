# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command        | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `init`         | Set up Ralphai in your project (configure agent and feedback commands) |
| `run`          | Create or reuse a worktree and run the next plan                       |
| `worktree`     | Manage Ralphai worktrees (`list`, `clean`)                             |
| `status`       | Show pipeline and worktree status                                      |
| `reset`        | Move in-progress plans back to backlog and clean up                    |
| `purge`        | Delete archived artifacts from `pipeline/out/`                         |
| `repos`        | List all known repos with pipeline summaries                           |
| `doctor`       | Check your Ralphai setup for problems                                  |
| `backlog-dir`  | Print the path to the plan backlog directory                           |
| `update [tag]` | Update Ralphai to the latest (or specified) version                    |
| `teardown`     | Remove Ralphai from your project                                       |
| `uninstall`    | Remove all global state and uninstall the CLI                          |

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

Works with: `status`, `reset`, `purge`, `teardown`, `backlog-dir`, `doctor`.

Blocked for: `run`, `worktree`, `init`.

## Interactive Dashboard

Running `ralphai` with no subcommand in a TTY launches the interactive dashboard.

Navigation:

- `1`, `2`, `3` focus the repo bar, pipeline, or detail pane
- `Tab` and `Shift+Tab` cycle between panes
- `Up` and `Down` move within the focused pane
- `Enter` opens detail or selects the current dropdown item
- `Esc` closes overlays or returns to the previous view
- `q` quits the dashboard from repo or pipeline focus

Detail tabs:

- `s` summary
- `p` plan
- `g` progress
- `o` output
- `l` toggles live-scroll in the output tab

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

What it does:

1. Picks a plan from `backlog/` or resumes one from `in-progress/`
2. Creates or reuses a worktree on `ralphai/<slug>`
3. Runs the agent inside that worktree
4. Commits and pushes the branch
5. Opens or updates a draft PR when `gh` is available

```
--dry-run, -n                     Preview what would happen without changing anything
--resume, -r                      Auto-commit dirty state and continue
--allow-dirty                     Skip the clean working tree check
--plan=<file>                     Target a specific backlog plan (default: auto-detect)
--agent-command=<command>         Override agent CLI command
--feedback-commands=<list>        Comma-separated feedback commands
--base-branch=<branch>            Override base branch (default: main)
--continuous                      Keep processing backlog plans after the first completes
--max-stuck=<n>                   Stuck threshold before abort (default: 3)
--iteration-timeout=<seconds>     Timeout per agent invocation (default: 0 = no timeout)
--auto-commit                     Enable auto-commit recovery snapshots
--no-auto-commit                  Disable auto-commit recovery snapshots (default)
--show-config                     Print resolved settings and exit
```

### Continuous Mode

`--continuous` keeps draining the backlog on one long-lived worktree branch.

- The first completed plan creates a draft PR
- Later plans update that same draft PR
- If the run is interrupted or gets stuck, Ralphai still pushes partial work
- The PR stays draft until a human marks it ready

### Issue Tracking

```
--issue-source=<source>           Issue source: 'none' or 'github' (default: none)
--issue-label=<label>             Label to filter issues (default: ralphai)
--issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)
--issue-repo=<owner/repo>         Override repo for issue operations (default: auto-detect)
--issue-comment-progress=<bool>   Comment on issue during run (default: true)
```

## Worktree

`ralphai worktree` is now a maintenance command. It does not start runs.

```bash
ralphai worktree list
ralphai worktree clean
```

- `list` shows active Ralphai-managed worktrees
- `clean` removes completed or orphaned worktrees and archives any leftover receipt

Use `ralphai run` to start or resume work.

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

## Teardown

```
--yes, -y         Skip confirmation prompt
```

Removes Ralphai from your project by deleting global state for this repo at `~/.ralphai/repos/<id>/`.

## Uninstall

Removes all global state in `~/.ralphai/` and uninstalls the CLI.

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
| `RALPHAI_CONTINUOUS`              | `continuous`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPHAI_MAX_LEARNINGS`           | `maxLearnings`         |
| `RALPHAI_NO_UPDATE_CHECK`         | _(none)_               |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
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

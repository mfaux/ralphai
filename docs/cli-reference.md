# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command        | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `init`         | Set up Ralphai in your project (configure agent and feedback commands) |
| `run`          | Start the Ralphai task runner                                          |
| `worktree`     | Run in an isolated git worktree                                        |
| `status`       | Show pipeline and worktree status                                      |
| `reset`        | Move in-progress plans back to backlog and clean up                    |
| `purge`        | Delete archived artifacts from `pipeline/out/`                         |
| `repos`        | List all known repos with pipeline summaries                           |
| `doctor`       | Check your Ralphai setup for problems                                  |
| `backlog-dir`  | Print the path to the plan backlog directory                           |
| `update [tag]` | Update ralphai to the latest (or specified) version                    |
| `teardown`     | Remove Ralphai from your project                                       |
| `uninstall`    | Remove all global state and uninstall the CLI                          |

## Global Options

```
--help, -h              Show help
--version, -v           Show version
--no-color              Disable colored output (also respects NO_COLOR env var)
--repo=<name-or-path>   Target a different repo by name or path (see below)
```

### `--repo` Flag

The `--repo` flag lets you run read-only commands against a different repo without changing directories. Pass a repo name (as shown by `ralphai repos`) or an absolute/relative path.

```bash
ralphai status --repo=my-app            # by name
ralphai doctor --repo=~/work/api        # by path
ralphai backlog-dir --repo=my-app       # print another repo's backlog path
```

Works with: `status`, `reset`, `purge`, `teardown`, `backlog-dir`, `doctor`. Blocked for `run`, `worktree`, and `init`, which must run inside the target repo.

### Interactive Dashboard

Running `ralphai` with no subcommand in a TTY launches an interactive dashboard. The dashboard shows all known repos, lets you drill into plans by state (backlog, in-progress, completed), and provides keyboard shortcuts for common actions:

- **Arrow keys** to navigate, **Enter** to select, **Esc** to go back, **q** to quit
- **r** to run a backlog plan, **w** to run in a worktree, **p** to preview, **x** to reset

The dashboard auto-refreshes every 3 seconds and filters out stale repos with no plans. In non-TTY environments (e.g., piped output), `ralphai` shows help text instead.

## Init

```
--yes, -y              Skip prompts; auto-detect agent (Claude Code → OpenCode → others)
--force                Re-scaffold from scratch
--agent-command=CMD    Set the agent command
```

In monorepo projects, `init` detects workspace packages from `pnpm-workspace.yaml`, `package.json` `workspaces`, or `.sln` files (for .NET projects). In mixed repos, workspaces from all ecosystems are merged. Both modes display workspace info without adding config; feedback commands are auto-filtered by scope at runtime.

## Run

### Mode Selection

```
--branch                          Branch mode (default): create isolated branch, commit, no PR
--pr                              PR mode: create branch, push, and open PR
--patch                           Patch mode: leave changes uncommitted in working tree
```

### General Options

```
--turns=<n>                       Turns per plan (default: 5, 0 = unlimited)
--dry-run, -n                     Preview what would happen without changing anything
--resume, -r                      Auto-commit dirty state and continue
--allow-dirty                     Skip the clean working tree check
--plan=<file>                     Target a specific backlog plan (default: auto-detect)
--agent-command=<command>         Override agent CLI command
--feedback-commands=<list>        Comma-separated feedback commands
--base-branch=<branch>            Override base branch (default: main)
--continuous                      Keep processing backlog plans after the first completes
--max-stuck=<n>                   Stuck threshold before abort (default: 3)
--turn-timeout=<seconds>          Timeout per agent invocation (default: 0 = no timeout)
--prompt-mode=<mode>              Prompt format: 'auto', 'at-path', or 'inline' (default: auto)
--show-config                     Print resolved settings and exit
```

### Patch Mode Options

```
--auto-commit                     Enable auto-commit of agent changes (per-turn and resume recovery)
--no-auto-commit                  Disable auto-commit (default)
```

### Issue Tracking

```
--issue-source=<source>           Issue source: 'none' or 'github' (default: none)
--issue-label=<label>             Label to filter issues (default: ralphai)
--issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)
--issue-repo=<owner/repo>         Override repo for issue operations (default: auto-detect)
--issue-comment-progress=<bool>   Comment on issue during run (default: true)
```

### Turn Budget

How many turns to allocate depends on plan complexity. Related tasks may be combined into a single turn if they won't fill the context window.

| Plan complexity                       | Recommended `--turns` |
| ------------------------------------- | --------------------- |
| Bug fix (1-2 tasks)                   | 2-3                   |
| Small feature (2-4 tasks)             | 3-5                   |
| Medium feature (4-8 tasks)            | 5-10                  |
| Large feature (8+ tasks, new modules) | 10-20                 |
| Structural refactor                   | 5-10                  |

Pass `--turns=0` for unlimited turns.

## Worktree

```
--plan=<file>     Target a specific backlog plan (default: auto-detect)
--dir=<path>      Worktree directory (default: ../.ralphai-worktrees/<slug>)
worktree list     Show active ralphai-managed worktrees
worktree clean    Remove completed/orphaned worktrees
```

## Reset

```
--yes, -y         Skip confirmation prompt
```

Resets pipeline state so you can start fresh:

- **Plans** — moves plan files from `in-progress/<slug>/` back to `backlog/` as flat `.md` files
- **Artifacts** — deletes `progress.md` and `receipt.txt` for each in-progress plan
- **Worktrees** — removes ralphai-managed worktrees and force-deletes their branches

Use `reset` when a run is stuck and you want to re-queue the plan, or when you want to abandon in-progress work and start over.

## Purge

```
--yes, -y         Skip confirmation prompt
```

Deletes all archived plan artifacts from `pipeline/out/`. Use this to clean up after completed runs.

## Doctor

Validates your Ralphai setup with diagnostic checks:

1. Config exists (global state)
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

Removes Ralphai from your project: deletes global state for this repo (`~/.ralphai/repos/<id>/`).

## Uninstall

Removes **all** global state (`~/.ralphai/`) and uninstalls the CLI. Unlike `teardown`, which only removes state for the current repo, `uninstall` is a full removal.

## Backlog Dir

Prints the absolute path to the plan backlog directory for the current repository. Useful for scripting or finding where to place plan files.

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
ralphai repos              # list all repos
ralphai repos --clean      # remove stale entries, then list
```

A repo entry is considered stale when its stored `repoPath` no longer exists on disk AND its pipeline is completely empty (no backlog, in-progress, or completed plans). Repos with plans are always preserved, even if the path is gone.

## Backlog Dir

Prints the absolute path to the plan backlog directory for the current repository. Useful for scripting or finding where to place plan files.

```bash
ralphai backlog-dir
# ~/.ralphai/repos/<repo-id>/pipeline/backlog
```

## Configuration

Settings resolve in this order: **CLI flags > env vars > `config.json` > defaults**.

### Environment Variables

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`             | `baseBranch`           |
| `RALPHAI_MODE`                    | `mode`                 |
| `RALPHAI_AUTO_COMMIT`             | `autoCommit`           |
| `RALPHAI_TURNS`                   | `turns`                |
| `RALPHAI_PROMPT_MODE`             | `promptMode`           |
| `RALPHAI_CONTINUOUS`              | `continuous`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_TURN_TIMEOUT`            | `turnTimeout`          |
| `RALPHAI_MAX_LEARNINGS`           | `maxLearnings`         |
| `RALPHAI_NO_UPDATE_CHECK`         | _(none)_               |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

### Prompt Modes

The `promptMode` setting controls how file references are formatted in the
prompt sent to the agent. Set it via `--prompt-mode`, `RALPHAI_PROMPT_MODE`, or
`promptMode` in `config.json`.

| Value         | Behavior                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auto`**    | (Default) Resolves to a concrete mode based on the detected agent type. Currently all agents map to `at-path`.                                                              |
| **`at-path`** | References files as `@filepath`. Lightweight and low-token — works when the agent can resolve file paths natively (e.g. Claude Code, OpenCode).                             |
| **`inline`**  | Embeds file contents directly as `<file path="...">contents</file>` XML blocks. Uses more tokens but works with any agent. Falls back to `@path` if the file doesn't exist. |

**When to change:** If your agent doesn't support `@path` file references, set
`promptMode` to `"inline"`. Otherwise, leave it at `"auto"`.

### Workspaces (Monorepo)

The `workspaces` key in `config.json` provides per-package feedback command
overrides for monorepo projects. Each key is a relative path matching a plan's
`scope` frontmatter value.

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

When a plan declares `scope: packages/web`, the runner checks for a matching
`workspaces` entry. If found, those feedback commands replace the top-level
ones. If no entry matches, the runner derives scoped commands automatically:

- **Node.js** — uses the package manager's workspace filter (detected from lockfiles).
- **C# / .NET** — appends the scope path to dotnet commands (e.g., `dotnet build src/Api`).
- **Other ecosystems** — commands pass through unchanged.

Workspaces are discovered from `pnpm-workspace.yaml`, `package.json` `workspaces`, or `.sln` files (which list `.csproj` projects). When multiple ecosystems coexist, Ralphai detects all of them and merges their feedback commands.

The `workspaces` key is optional. Without it, scoped plans still get
automatically derived feedback commands.

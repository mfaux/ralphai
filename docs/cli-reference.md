# CLI Reference

```
ralphai <command> [options]
```

## Commands

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `init`           | Set up Ralphai in your project                      |
| `run`            | Start the Ralphai task runner                       |
| `worktree`       | Run in an isolated git worktree                     |
| `status`         | Show pipeline and worktree status                   |
| `reset`          | Move in-progress plans back to backlog and clean up |
| `update [tag]`   | Update ralphai to the latest (or specified) version |
| `uninstall`      | Remove Ralphai from your project                    |

## Global Options

```
--help, -h        Show help
--version, -v     Show version
```

## Init

```
--yes, -y              Skip prompts, use defaults
--force                Re-scaffold from scratch
--agent-command=CMD    Set the agent command
```

## Run

```
--turns=<n>                       Turns per plan (default: 5, 0 = unlimited)
--dry-run, -n                     Preview what would happen without changing anything
--resume, -r                      Auto-commit dirty state and continue
--agent-command=<command>         Override agent CLI command
--feedback-commands=<list>        Comma-separated feedback commands
--base-branch=<branch>            Override base branch (default: main)
--branch                          Branch mode (default): create isolated branch, commit, no PR
--pr                              PR mode: create branch, push, and open PR
--patch                           Patch mode: leave changes uncommitted in working tree
--continuous                      Keep processing backlog plans after the first completes
--max-stuck=<n>                   Stuck threshold before abort (default: 3)
--turn-timeout=<seconds>          Timeout per agent invocation (default: 0 = no timeout)
--auto-commit                     Enable auto-commit of agent changes (per-turn and resume recovery)
--no-auto-commit                  Disable auto-commit (default)
--prompt-mode=<mode>              Prompt format: 'auto', 'at-path', or 'inline' (default: auto)
--show-config                     Print resolved settings and exit
--issue-source=<source>           Issue source: 'none' or 'github' (default: none)
--issue-label=<label>             Label to filter issues (default: ralphai)
--issue-in-progress-label=<label> Label applied when issue is picked up (default: ralphai:in-progress)
--issue-repo=<owner/repo>         Override repo for issue operations (default: auto-detect)
--issue-close-on-complete=<bool>  Close issue on plan completion (default: true)
--issue-comment-progress=<bool>   Comment on issue during run (default: true)
```

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

## Configuration

Settings resolve in this order: **CLI flags > env vars > `ralphai.json` > defaults**.

### Environment Variables

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`            | `baseBranch`           |
| `RALPHAI_MODE`                    | `mode`                 |
| `RALPHAI_AUTO_COMMIT`             | `autoCommit`           |
| `RALPHAI_TURNS`                   | `turns`                |
| `RALPHAI_PROMPT_MODE`             | `promptMode`           |
| `RALPHAI_CONTINUOUS`              | `continuous`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_TURN_TIMEOUT`            | `turnTimeout`          |
| `RALPHAI_NO_UPDATE_CHECK`         | _(none)_               |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

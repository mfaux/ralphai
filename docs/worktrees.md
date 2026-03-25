# Worktrees

Git worktrees let you run plans in parallel without switching branches.
Each worktree is a separate directory with its own working tree, sharing
the same git history.

Back to the [README](../README.md) for setup and quickstart.

## When to use worktrees

- Running multiple plans concurrently
- Keeping your main checkout clean while Ralphai works
- Avoiding branch-switching interruptions

## Commands

```bash
ralphai worktree list                     # show active worktrees
ralphai worktree clean                    # remove completed worktrees
```

The lifecycle: `ralphai run` creates or reuses a worktree → runs the plan there → pushes a branch → opens or updates a draft PR → `ralphai worktree clean` removes finished worktrees.

Run `ralphai run` from the **main repository**, not from inside a worktree.

## How it works

1. `ralphai run` creates a git worktree with a `ralphai/<plan-slug>` branch.
   It reuses existing worktrees for in-progress plans.
2. Ralphai runs the agent inside that worktree and keeps the main checkout clean.

Configuration and pipeline data live in global state (`~/.ralphai/repos/<id>/`),
so they are automatically available in every worktree without symlinks.

## Agent compatibility

| Agent       | Worktree support | Notes                            |
| ----------- | ---------------- | -------------------------------- |
| Claude Code | Yes              | Tested                           |
| OpenCode    | Yes              | Tested                           |
| Codex       | No               | Container sandbox restrictions   |
| Others      | Likely           | Untested — no known restrictions |

**Workaround for unsupported agents:** Set `"promptMode": "inline"` in
`config.json` to embed pipeline file contents directly in the prompt,
bypassing the agent's need to access external paths.

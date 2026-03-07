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
ralphai worktree                          # auto-pick next backlog plan
ralphai worktree --turns=3                # limit turns
ralphai worktree --plan=dark-mode.md      # target a specific plan
ralphai worktree list                     # show active worktrees
ralphai worktree clean                    # remove completed worktrees
```

The lifecycle: create worktree → run plan → create PR → clean up. If the
agent gets stuck, the worktree is preserved — re-run `ralphai worktree`
to reuse it, or resume inside with `ralphai run --resume`.

`ralphai worktree` must be run from the **main repository**, not from inside
a worktree. All runner options are forwarded automatically.

## How it works

1. Creates a git worktree with a `ralphai/<plan-slug>` branch.
   Reuses existing worktrees for in-progress plans.
2. Symlinks the worktree's `.ralphai/` to the main repo's `.ralphai/`
   so the agent can access pipeline files through relative paths
   (bypassing agent directory sandboxing).
3. Spawns the runner in the worktree directory.
4. Config (`ralphai.json`) is tracked by git and checked out automatically.

## Agent compatibility

| Agent       | Worktree support | Notes                                                       |
| ----------- | ---------------- | ----------------------------------------------------------- |
| Claude Code | Yes              | Tested — follows symlinks within project directory          |
| OpenCode    | Yes              | Tested — follows symlinks within working directory          |
| Codex       | No               | Container sandbox may not follow symlinks outside the mount |
| Others      | Likely           | Untested — no known restrictions                            |

**Workaround for unsupported agents:** Set `"promptMode": "inline"` in
`ralphai.json` to embed pipeline file contents directly in the prompt,
bypassing the agent's need to access external paths.

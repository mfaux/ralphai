# Worktrees

Git worktrees let you run plans in parallel without stashing or switching
branches. Each worktree is a separate directory with its own working tree and
branch, sharing the same git history.

Back to the [README](../README.md) for setup and quickstart.

## When to use worktrees

- Running multiple plans concurrently (each in its own worktree)
- Keeping your main checkout clean while Ralphai works in an isolated directory
- Avoiding branch-switching interruptions during autonomous runs

## Commands

### Run a plan in a worktree

```bash
ralphai worktree                          # auto-pick next backlog plan
ralphai worktree --turns=3                # run with 3 turns per plan
ralphai worktree --plan=prd-dark-mode.md  # target a specific plan
```

The lifecycle: create worktree → run plan (in PR mode) → create PR → clean up.
If the agent gets stuck or times out, the worktree is preserved. Re-run
`ralphai worktree` from the main repo to reuse it, or resume inside the
worktree with `ralphai run --resume`.

`ralphai worktree` must be run from the **main repository**, not from inside a
worktree. All runner options (`--turns`, `--agent-command`, `--feedback-commands`, etc.)
are forwarded automatically.

Options:

- `--plan=<file>` — Target a specific backlog plan (default: auto-detect)
- `--dir=<path>` — Worktree directory (default: `../.ralphai-worktrees/<slug>`)

### List active worktrees

```bash
ralphai worktree list
```

Shows all git worktrees on `ralphai/*` branches.

### Clean up worktrees

```bash
ralphai worktree clean
```

Removes worktrees whose plans are no longer in `in-progress/`. Worktrees with
active plans are preserved.

## How it works

1. `ralphai worktree` creates a git worktree (a separate working directory
   sharing the same `.git` history) and a new `ralphai/<plan-slug>` branch.
   If that plan is already in progress, it reuses the existing managed
   worktree instead of creating a second one.
2. A **symlink** is created from the worktree's `.ralphai/` to the main repo's
   `.ralphai/` directory. This is critical for agent compatibility (see below).
3. The runner is spawned with the worktree as its working directory.
4. When the runner detects the symlink, it uses **relative paths** (e.g.,
   `.ralphai/pipeline/in-progress/`) in the prompt sent to the agent.

Pipeline state (`.ralphai/pipeline/`) lives in the main worktree and is shared
across all worktrees via the symlink.

## The sandbox problem

Most AI coding agents enforce **directory sandboxing** — they restrict file
access to the agent's working directory (the worktree). Without the symlink,
pipeline files live at absolute paths in the main repo
(e.g., `/home/user/project/.ralphai/pipeline/in-progress/`), which the agent
rejects as "external directory" access.

The symlink makes `.ralphai/` appear local to the worktree, so the agent can
read and write pipeline files through relative paths.

## Agent compatibility

| Agent       | Worktree support | Notes                                                       |
| ----------- | ---------------- | ----------------------------------------------------------- |
| OpenCode    | Yes              | Follows symlinks within working directory                   |
| Claude Code | Yes              | Follows symlinks within project directory                   |
| Gemini CLI  | Yes              | No known sandbox restrictions                               |
| Aider       | Yes              | No directory sandbox                                        |
| Goose       | Likely           | Untested                                                    |
| Amp         | Likely           | Untested                                                    |
| Kiro        | Likely           | Untested                                                    |
| Codex       | No               | Container sandbox may not follow symlinks outside the mount |

**Workaround for unsupported agents:** Set `"promptMode": "inline"` in
`.ralphai/ralphai.config.json`. This causes the runner (bash) to read pipeline files
and embed their contents directly in the prompt, bypassing the agent's need to
access external paths. This increases prompt size but works with all agents.

## Manual worktrees

You can also create worktrees manually instead of using `ralphai worktree`:

```bash
# Create the worktree
git worktree add ../feature-x -b ralphai/feature-x main

# Add the symlink so the agent can access pipeline files
cd ../feature-x
ln -s /path/to/main-repo/.ralphai .ralphai

# Run ralphai
ralphai run --pr
```

Without the symlink, the runner falls back to absolute paths pointing to the
main repo. This works for the runner's own bash operations, but agents with
directory sandboxing will reject reads/writes to those paths.

Ralphai auto-detects worktrees — no extra flags needed. Use
`ralphai run --show-config` inside a worktree to verify detection
(`worktree = true`).

**Important:**

- `ralphai init` must be run in the **main repository**, not inside a
  worktree.
- `ralphai run` works in both the main repo and any worktree.

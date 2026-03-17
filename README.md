# ralphai

Put your AI coding agent on autopilot.

Ralphai takes plans (markdown files) from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans, or have your agent write them. Ralphai does the rest.

Requires Node.js 18+ and a [supported CLI agent](#supported-agents).

## Try It Now

```bash
npx ralphai init --yes           # scaffold .ralphai/ with a sample plan
git checkout -b try-ralphai      # switch to a feature branch
npx ralphai run                  # watch the agent complete the sample plan
```

`init --yes` creates a sample plan in the backlog so you can see the full loop immediately, no plan writing required.

## Why Ralphai?

AI coding agents get worse the longer they run. As the conversation grows, the model drops older context: it forgets what it tried, repeats mistakes, and drifts.

Ralphai avoids this by starting each turn with a **fresh session**: just the plan and a progress log. No conversation history to lose. No drift.

- **No context rot** — turn 10 is as sharp as turn 1
- **Fresh feedback** — real build output every cycle, never recalled from memory
- **Stuck detection** — stops burning tokens when progress stalls

[How it works →](docs/how-ralphai-works.md)

## Install

```bash
npm install -g ralphai       # install globally for regular use
npx ralphai                  # run without installing
```

## Get Started

In your project repository:

```bash
ralphai init                 # scaffold .ralphai/ and ralphai.json
```

Ralphai detects your package manager and build scripts automatically. Use `--yes` to skip prompts.

All Ralphai files are gitignored by default; your workflow config is personal. To share config with your team instead, use `ralphai init --shared` to track `ralphai.json` in git. See [Workflows](docs/workflows.md) for details.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in the Ralphai backlog, using `.ralphai/PLANNING.md` as a guide.

```
Create a plan in the ralphai backlog for adding dark mode support.
Use .ralphai/PLANNING.md as a guide.
```

### 2. Run

Ralphai commits on your **current branch** by default. It refuses to run on `main`/`master`, so switch to a feature branch first.

```bash
git checkout -b my-feature
ralphai run
```

Each turn: the agent reads the plan, implements the next task, runs build/test/lint, fixes errors, and commits. Then a fresh session starts for the next turn.

```bash
ralphai run --turns=3    # 3 turns per plan (default: 5)
ralphai run --turns=0    # unlimited turns
ralphai run --pr         # create a ralphai/* branch and open a PR
ralphai run --dry-run    # preview without changing anything
```

For parallel work, run in a [git worktree](docs/worktrees.md):

```bash
ralphai worktree                    # auto-pick next backlog plan
ralphai worktree list               # show active worktrees
ralphai worktree clean              # remove completed worktrees
```

### 3. Steer

Plans flow through the pipeline:

```
parked/    backlog/  →  in-progress/  →  out/
```

Park unready plans in `parked/`. Ralphai ignores that folder.
Plans are flat `.md` files in `backlog/` (for example `backlog/my-plan.md`). The runner creates a slug folder automatically when moving a plan to `in-progress/`.

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/<slug>/`. Resume with `ralphai run`, which auto-detects in-progress work. Use `ralphai status` to see what's queued, in progress, and any problems.

### 5. Close the learnings loop

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) and flags durable lessons in `.ralphai/LEARNING_CANDIDATES.md` for human review. After a run, review candidates and promote useful ones to `AGENTS.md` or skill docs. [More on learnings →](docs/how-ralphai-works.md#learnings-system)

## Monorepo Support

`ralphai init` automatically detects workspace packages from `pnpm-workspace.yaml` or the `workspaces` field in `package.json`. In interactive mode, it offers to add per-workspace feedback commands to `ralphai.json`. In `--yes` mode, it prints the detected workspaces and relies on automatic scope filtering at runtime.

Plans can target a specific package by adding `scope` to the frontmatter:

```md
---
scope: packages/web
---
```

When a plan has a scope, Ralphai rewrites feedback commands using the package manager's workspace filter (e.g., `pnpm --filter @org/web build`). The agent prompt includes a hint to focus on the scoped directory.

`ralphai status` annotates each plan with its scope when declared, and `ralphai doctor` validates per-workspace feedback commands when a `workspaces` config exists (failures produce warnings, not hard errors).

For custom per-package overrides, add a `workspaces` key to `ralphai.json`:

```json
{
  "workspaces": {
    "packages/web": {
      "feedbackCommands": ["pnpm --filter web build", "pnpm --filter web test"]
    }
  }
}
```

## Supported Agents

Ralphai works with any CLI agent that accepts a prompt argument. **Claude Code** and **OpenCode** are actively tested.

<details>
<summary>Agent commands</summary>

| Agent       | Command                          | Status   |
| ----------- | -------------------------------- | -------- |
| Claude Code | `claude -p`                      | Tested   |
| OpenCode    | `opencode run --agent build`     | Tested   |
| Codex       | `codex exec`                     | Untested |
| Gemini CLI  | `gemini -p`                      | Untested |
| Aider       | `aider --message`                | Untested |
| Goose       | `goose run -t`                   | Untested |
| Kiro        | `kiro-cli chat --no-interactive` | Untested |
| Amp         | `amp -x`                         | Untested |

</details>

## Reference

- [CLI Reference](docs/cli-reference.md) — all commands, flags, and configuration
- [How Ralphai Works](docs/how-ralphai-works.md) — context rot, feedback loops, stuck detection
- [Worktrees](docs/worktrees.md) — parallel runs in isolated directories
- [Workflows](docs/workflows.md) — common patterns and recipes
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — creator of the technique behind the loop
- [Getting Started With Ralph](https://www.aihero.dev/getting-started-with-ralph) by Matt Pocock
- [Vercel CLI](https://github.com/vercel/vercel) for CLI DX inspiration

## License

MIT

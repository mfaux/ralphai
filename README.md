# ralphai

Put your AI coding agent on autopilot.

Ralphai takes [plan files](#1-write-plans) (markdown) from its backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans (or have your agent write them). Ralphai does the rest.

## Why Ralphai?

AI coding agents get worse the longer they run. As the conversation grows, the model drops older context — it forgets what it tried, repeats mistakes, and drifts.

Ralphai avoids this by starting each **turn** with a **fresh session**: just the plan and a progress log. No conversation history to lose, no drift.

- **No context rot** — turn 10 is as sharp as turn 1
- **Fresh feedback** — real build output every cycle, never recalled from memory
- **Stuck detection** — stops burning tokens when progress stalls

[How it works →](docs/how-ralphai-works.md)

## Install

```bash
npm install -g ralphai       # global (recommended)
npm install -D ralphai       # local dev dependency
npx ralphai                  # no install, runs latest
```

## Get Started

```bash
ralphai init                 # scaffold .ralphai/ and ralphai.json
```

Ralphai detects your package manager and build scripts automatically. Use `--yes` to skip prompts.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralphai/pipeline/backlog/`. Point it at `.ralphai/PLANNING.md` for structure and examples.

```
Create a plan in the ralphai backlog for adding dark mode support.
Use PLANNING.md as a guide.
```

> Plan files are **gitignored** — local-only state.

### 2. Run

Ralphai commits on your **current branch** by default. It refuses to run on `main`/`master` — switch to a feature branch first.

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

Plans flow through `backlog/` → `in-progress/` → `out/`. Park unready plans in `wip/` — Ralphai ignores that folder.

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/`. Resume with `ralphai run` — it auto-detects in-progress work. Use `ralphai status` to see what's queued, in progress, and any problems.

### 5. Close the learnings loop

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs. After a run, review entries and promote durable lessons to `AGENTS.md` or skill docs. [More →](docs/how-ralphai-works.md#learnings-system)

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

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — creator of the technique behind the loop
- [Getting Started With Ralph](https://www.aihero.dev/getting-started-with-ralph) by Matt Pocock
- [Vercel CLI](https://github.com/vercel/vercel) for CLI DX inspiration

## License

MIT

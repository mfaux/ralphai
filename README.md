# ralphai

Put your AI coding agent on autopilot.

Point Ralphai at a GitHub issue. It drives your AI coding agent through fresh-session iterations — with branch isolation, build/test feedback loops, and stuck detection — until the PR is ready.

## Why Ralphai?

AI coding agents get worse the longer they run. As the conversation grows, the model drops older context: it forgets what it tried, repeats mistakes, and drifts.

Ralphai avoids this by starting each iteration with a **fresh agent session**: just the plan and a progress log. No conversation history to lose. No drift.

- **No context rot** — iteration 10 is as sharp as iteration 1
- **Fresh feedback** — real build output every cycle, never recalled from memory
- **Stuck detection** — stops burning tokens when progress stalls

[How it works →](docs/how-ralphai-works.md)

## Try It Now

```bash
npx ralphai init --yes       # auto-detect agent and project setup
ralphai run 42               # run GitHub issue #42
```

Ralphai creates an isolated worktree, drives your agent through build/test feedback loops, and opens a draft PR when done. `init --yes` auto-detects installed agents (checking **Claude Code** and **OpenCode** first) and your project's build/test commands.

## Install

Requires Node.js 18+ (or Bun/Deno) and a [supported CLI agent](#supported-agents).

```bash
npm install -g ralphai                    # install the CLI
npx skills add mfaux/ralphai -g           # install agent skills (recommended)
```

<details>
<summary>Included skills</summary>

- **write-a-prd** — create a product requirements document through interactive interview
- **prd-to-issues** — decompose a PRD into vertical-slice GitHub sub-issues
- **triage-issue** — investigate bugs and create TDD fix plans
- **tdd** — test-driven development with red-green-refactor loops
- **improve-codebase-architecture** — find and propose module-deepening refactors
- **request-refactor-plan** — plan structural changes with tiny, verifiable commits
- **ralphai-planning** — write local plan files for autonomous execution

</details>

## How It Works

### 1. Plan with your agent

Use the included skills to turn ideas into GitHub issues your agent can execute:

- **Features** — ask your agent to `write-a-prd`, then `prd-to-issues` to decompose it into labeled sub-issues. Ralphai processes them sequentially on one branch and opens a single aggregate PR.
- **Bugs & small tasks** — ask your agent to `triage-issue` to investigate and create a standalone issue. Each gets its own branch and PR.

Both skills label the issues automatically (`ralphai-prd` / `ralphai-standalone`). You can also label issues by hand. Labels are [configurable](docs/cli-reference.md#labels).

### 2. Run

```bash
ralphai run 42               # run a specific issue (PRD or standalone)
ralphai run --drain           # process all eligible issues until the queue is empty
ralphai run --dry-run         # preview without changing anything
```

Each run creates an isolated [worktree](docs/worktrees.md) on a conventional `<type>/<slug>` branch, iterates the agent with fresh build/test feedback, and opens a draft PR when done. Stuck sub-issues are skipped so progress continues.

### 3. Review the PR

Ralphai surfaces extracted **learnings** in the draft PR — patterns the agent discovered during implementation. Promote useful ones to `AGENTS.md` or skill docs. [More on learnings →](docs/how-ralphai-works.md#learnings-system)

### Interactive mode

Running bare `ralphai` opens a TUI to browse the pipeline, pick issues, and launch runs without memorizing subcommands.

### Local plan files

You can also drive Ralphai with local markdown files instead of GitHub issues — see [Workflows → Local plan files](docs/workflows.md#local-plan-files).

## Day-to-Day

```bash
ralphai                  # open the interactive menu
ralphai status           # see what's queued, running, and completed
ralphai stop             # stop the active runner (or --all)
ralphai run --resume     # commit dirty state and continue
ralphai doctor           # validate setup (agent, feedback, config, git)
ralphai reset            # reset stuck plans
ralphai clean            # remove archived plans and orphaned worktrees
```

Press **Ctrl-C** during a headless run to stop cleanly after the current iteration. Work is preserved and `ralphai run` picks up where it left off.

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
- [Hooks, Gates, and Prompt Controls](docs/hooks.md) — advanced customization
- [Workflows](docs/workflows.md) — common patterns and recipes
- [Worktrees](docs/worktrees.md) — parallel runs in isolated directories
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — creator of the technique behind the loop
- [Getting Started With Ralph](https://www.aihero.dev/getting-started-with-ralph) by Matt Pocock
- [mattpocock/skills](https://github.com/mattpocock/skills) — inspiration for the planning and TDD skills
- [Sandcastle](https://github.com/ai-hero/sandcastle) by AI Hero — demonstrated the ephemeral-container-per-invocation pattern for agent sandboxing
- [Caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee — inspiration for the caveman communication skill
- [Vercel CLI](https://github.com/vercel/vercel) for CLI DX inspiration

## License

MIT

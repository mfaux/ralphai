# ralphai

Put your AI coding agent on autopilot.

Ralph takes plan files from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans (or have your agent write them). Ralph does the rest.

## Why Ralph?

AI coding agents get worse the longer they run. Every model can only "see" a limited amount of text at once (its context window). As the conversation grows, the model quietly drops or summarizes older messages. It forgets what it already tried, repeats mistakes, or contradicts earlier work. [More on this →](docs/HOW-IT-WORKS.md#context-rot)

Ralph avoids this by starting each iteration with a **fresh session**: just the plan, current repo state, and build/test/lint results. No conversation history to lose, no drift.

- **No context rot** — iteration 50 is as sharp as iteration 1
- **Grounded feedback** — real build errors every cycle, not stale memory
- **Stuck detection** — stops burning tokens when progress stalls
- **Unattended** — write plans, walk away

## Get Started

In your project directory:

```bash
npx ralphai init
```

Ralph scaffolds a `.ralph/` directory into your project, detects your package manager and build scripts, and you're ready to go.

> Use `npx ralphai init --yes` to skip prompts and accept defaults.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralph/backlog/`. Point it at `.ralph/PLANNING.md` for structure and examples, or roll your own format. Ralph just needs markdown files with clear acceptance criteria.

```
Create a plan in the ralph backlog for adding dark mode support.
Use PLANNING.md as a guide.
```

### 2. Run

```bash
npx ralphai run
```

Or call the shell script directly:

```bash
./.ralph/ralph.sh
```

Ralph picks the best plan from the backlog, creates a `ralph/*` branch, hands the plan to your agent, and loops: build, test, lint after every iteration. When a plan is done, it pushes the branch and opens a pull request. Defaults to 5 iterations per plan (e.g. `./.ralph/ralph.sh 3` for 3). If a plan isn't finished, it stays in `in-progress/` on the branch — just run again to resume.

### 3. Steer

Not ready for Ralph to pick something up? Keep it in `.ralph/drafts/`. Move to `backlog/` when ready.

```
drafts/        ← parked, ralph ignores
backlog/       ← queued, ralph picks from here
in-progress/   ← ralph is working on it
out/           ← done, archived
```

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/` on the `ralph/*` branch. Resume with `npx ralphai run` (auto-detects in-progress work). Preview what Ralph would do without touching anything: `./.ralph/ralph.sh --dry-run`.

### 5. Close the learnings loop

Ralph logs mistakes to `.ralph/LEARNINGS.md` (gitignored) during runs. After a run, review those entries and promote durable lessons to `LEARNINGS.md` (tracked) or `AGENTS.md`. [How the learnings system works →](docs/HOW-IT-WORKS.md#learnings-system)

## How `ralphai` Works

- **Branch isolation** — every plan runs on a `ralph/<plan-name>` branch, never on main
- **Feedback loops** — build, test, and lint run after each iteration (auto-detected or configured)
- **Stuck detection** — if N iterations produce no commits, Ralph aborts (default: 3)
- **Auto-PR** — creates a branch and opens a PR via `gh` by default; use `--direct` to commit on your current branch instead
- **Plan dependencies** — plans can declare `depends-on` for ordering across a backlog
- **GitHub Issues** — Ralph can pull labeled issues when the backlog is empty

See [How It Works](docs/HOW-IT-WORKS.md) for the full picture.

## Docs

After `ralphai init`, the good stuff lives in `.ralph/`:

- [`.ralph/README.md`](.ralph/README.md) — full operational docs (lifecycle, scripts, config)
- [`.ralph/PLANNING.md`](.ralph/PLANNING.md) — guide for writing plan files (give this to your agent)
- `LEARNINGS.md` (repo root) — curated long-term findings; compacted/promoted from `.ralph/LEARNINGS.md`

## Supported Agents

Works with any CLI agent that accepts a prompt argument:

<details>
<summary>Agent commands</summary>

| Agent       | Command                          |
| ----------- | -------------------------------- |
| OpenCode    | `opencode run --agent build`     |
| Claude Code | `claude -p`                      |
| Codex       | `codex exec`                     |
| Gemini CLI  | `gemini -p`                      |
| Aider       | `aider --message`                |
| Goose       | `goose run -t`                   |
| Kiro        | `kiro-cli chat --no-interactive` |
| Amp         | `amp -x`                         |

</details>

## CLI Reference

<details>
<summary>Commands and options</summary>

```
ralphai <command> [options]

Commands:
  init        Set up Ralph in your project
  run         Start the Ralph task runner
  update      Refresh template files (preserves config & state)
  uninstall   Remove Ralph from your project

Options:
  --help, -h     Show help
  --version, -v  Show version

Init:
  --yes, -y              Skip prompts, use defaults
  --force                Re-scaffold from scratch
  --agent-command=CMD    Set the agent command

Run:
  Runs with sensible defaults (5 iterations per plan). Use -- to override
  (e.g. -- 5 for 5 iterations, -- --dry-run for preview).
  In initialized repos, ./.ralph/ralph.sh is also available for direct invocation.
```

</details>

## Configuration

Settings resolve in this order: **CLI flags > env vars > `.ralph/ralph.config` > defaults**.

<details>
<summary>Environment variables</summary>

| Env Var                         | Config Key             |
| ------------------------------- | ---------------------- |
| `RALPH_AGENT_COMMAND`           | `agentCommand`         |
| `RALPH_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPH_BASE_BRANCH`             | `baseBranch`           |
| `RALPH_MODE`                    | `mode`                 |
| `RALPH_PROMPT_MODE`             | `promptMode`           |
| `RALPH_MAX_STUCK`               | `maxStuck`             |
| `RALPH_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPH_ISSUE_SOURCE`            | `issueSource`          |
| `RALPH_ISSUE_LABEL`             | `issueLabel`           |
| `RALPH_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPH_ISSUE_REPO`              | `issueRepo`            |
| `RALPH_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPH_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

</details>

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — the technique behind the loop
- [Vercel CLI](https://github.com/vercel/vercel) — CLI DX inspiration

## License

MIT

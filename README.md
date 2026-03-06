# ralphai

Put your AI coding agent on autopilot.

Ralphai takes plan files from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans (or have your agent write them). Ralphai does the rest.

## Why Ralphai?

AI coding agents get worse the longer they run. Every model can only "see" a limited amount of text at once (its context window). As the conversation grows, the model quietly drops or summarizes older messages. It forgets what it already tried, repeats mistakes, or contradicts earlier work. [More on this →](docs/HOW-RALPHAI-WORKS.md#context-rot)

Ralphai avoids this by starting each turn with a **fresh session**: just the plan, current repo state, and build/test/lint results. No conversation history to lose, no drift.

- **No context rot** — turn 50 is as sharp as turn 1
- **Grounded feedback** — real build errors every cycle, not stale memory
- **Stuck detection** — stops burning tokens when progress stalls
- **Unattended** — write plans, walk away

## Install

**Global** (recommended for individual use):

```bash
npm install -g ralphai
```

**Local dev dependency** (for teams — pins the version in package.json):

```bash
npm install -D ralphai
```

**npx** (no install, runs latest):

```bash
npx ralphai
```

## Get Started

In your project directory:

```bash
ralphai init
```

Ralphai scaffolds a `.ralphai/` directory into your project with config, docs, and a plan pipeline. It detects your package manager and build scripts automatically.

> Use `ralphai init --yes` to skip prompts and accept defaults.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralphai/pipeline/backlog/`. Point it at `.ralphai/PLANNING.md` for structure and examples, or roll your own format. Ralphai just needs markdown files with clear acceptance criteria.

> Plan files are **gitignored** — they're local-only state, not tracked by git.

```
Create a plan in the ralphai backlog for adding dark mode support.
Use PLANNING.md as a guide.
```

### 2. Run

Ralphai commits on your current branch by default. It refuses to run on `main`/`master` — create or switch to a feature branch first.

```bash
git checkout -b my-feature
ralphai run
```

Ralphai picks a plan from the backlog, hands it to your agent, and loops. Each turn, the agent works on one task, then ralphai runs build, test, and lint. When a plan is done, it commits the changes on your current branch.

Common options:

```bash
ralphai run 3            # 3 turns per plan (default: 5)
ralphai run --pr         # create a ralphai/* branch and open a PR instead
ralphai run --dry-run    # preview what ralphai would do without changing anything
```

### 3. Steer

Plans flow through three directories: `backlog/ → in-progress/ → out/`. Not ready for Ralphai to pick something up? Park it in `wip/` — Ralphai ignores that folder.

```
pipeline/backlog/       ← queued, ralphai picks from here
pipeline/in-progress/   ← ralphai is working on it
pipeline/out/           ← done, archived
pipeline/wip/           ← parked, ralphai ignores
```

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/`. Resume by running `ralphai run` again — it auto-detects in-progress work.

### 5. Close the learnings loop

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs. After a run, review those entries and promote durable lessons to `LEARNINGS.md` (tracked) or `AGENTS.md`. [How the learnings system works →](docs/HOW-RALPHAI-WORKS.md#learnings-system)

### After you're set up

1. **Commit the `.ralphai/` folder to git.** The config and docs
   are designed to be shared with your team.

2. **Review `.ralphai/ralphai.config`** and adjust settings (agent command,
   feedback commands, base branch, etc.).

## How Ralphai Works

- **Direct mode by default** — commits on your current branch, no branch creation or PR
- **`--pr` mode** — creates a `ralphai/<plan-name>` branch and opens a PR via `gh`
- **Feedback loops** — build, test, and lint run after each turn (auto-detected or configured)
- **Stuck detection** — if N turns produce no commits, Ralphai aborts (default: 3)
- **Plan dependencies** — plans can declare `depends-on` for ordering across a backlog
- **GitHub Issues** — Ralphai can pull labeled issues when the backlog is empty

See [How Ralphai Works](docs/HOW-RALPHAI-WORKS.md) for the full picture.

## Docs

After `ralphai init`, the good stuff lives in `.ralphai/`:

- [`.ralphai/README.md`](.ralphai/README.md) — full operational docs (lifecycle, config)
- [`.ralphai/PLANNING.md`](.ralphai/PLANNING.md) — guide for writing plan files (give this to your agent)
- `LEARNINGS.md` (repo root) — curated long-term findings; compacted/promoted from `.ralphai/LEARNINGS.md`

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
  init        Set up Ralphai in your project
  run         Start the Ralphai task runner
  update      Refresh template files (preserves config & state)
  uninstall   Remove Ralphai from your project

Options:
  --help, -h     Show help
  --version, -v  Show version

Init:
  --yes, -y              Skip prompts, use defaults
  --force                Re-scaffold from scratch
  --agent-command=CMD    Set the agent command

Run:
  Runs with sensible defaults (5 turns per plan).
  Arguments after 'run' are forwarded directly.
  See ralphai run --help for all options (--pr, --dry-run, --resume, etc.).
```

</details>

## Configuration

Settings resolve in this order: **CLI flags > env vars > `.ralphai/ralphai.config` > defaults**.

<details>
<summary>Environment variables</summary>

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`             | `baseBranch`           |
| `RALPHAI_MODE`                    | `mode`                 |
| `RALPHAI_PROMPT_MODE`             | `promptMode`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_TURN_TIMEOUT`            | `turnTimeout`          |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

</details>

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — the technique behind the loop
- [Vercel CLI](https://github.com/vercel/vercel) — CLI DX inspiration

## License

MIT

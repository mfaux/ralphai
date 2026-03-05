# Changelog

## 0.1.0 — Initial Release

Put your AI coding agent on autopilot.

Ralph takes plan files from a backlog and drives any CLI-based coding agent to implement them — with branch isolation, feedback loops, and stuck detection baked in.

### Highlights

- **`npx ralphai init`** — interactive wizard scaffolds `.ralph/` into your project, auto-detects package manager and build/test/lint scripts
- **Plan-based workflow** — write plans in `.ralph/backlog/`, Ralph picks them up, creates branches, and loops your agent through build/test/lint cycles
- **8 agent presets** — OpenCode, Claude Code, Codex, Gemini CLI, Aider, Goose, Kiro, Amp
- **Branch isolation** — every plan runs on a `ralph/<plan-name>` branch
- **Stuck detection** — aborts after N iterations with no progress (default: 3)
- **Auto-PR** — creates a branch and opens a PR via `gh` by default; use `--direct` to commit on your current branch instead
- **Resume support** — `--resume` picks up where you left off
- **Dry-run mode** — `--dry-run` previews what Ralph would do without touching anything
- **GitHub Issues integration** — optionally pulls labeled issues when the backlog is empty
- **Plan dependencies** — `depends-on` field for ordering across a backlog
- **Learnings loop** — two-tier system for logging and curating lessons across runs
- **Update & uninstall** — `ralphai update` refreshes templates; `ralphai uninstall` cleans up

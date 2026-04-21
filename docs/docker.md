# Docker Sandbox

When `sandbox` is `"docker"`, Ralphai wraps each agent invocation in an ephemeral Docker container instead of spawning the agent as a local child process. The runner's feedback loop, progress extraction, and completion gate work identically — only the process execution layer changes.

Back to the [README](../README.md) for setup and quickstart.

## How it works

The executor abstraction (`src/executor/`) decouples process spawning from the runner loop. A factory selects the strategy:

- `sandbox: "none"` → `LocalExecutor` — spawns the agent as a local child process
- `sandbox: "docker"` → `DockerExecutor` — spawns `docker run --rm` with the agent command inside

Each `DockerExecutor.spawn()` call builds a `docker run --rm` command with:

1. **Worktree bind-mount** — the worktree directory is mounted at its host path (`-v /path:/path`), so file references in agent output remain valid.
2. **Credential env vars** — forwarded via `-e VAR` (Docker reads the value from the host environment, preventing value leakage in process listings).
3. **Credential file mounts** — agent-specific config files mounted read-only (`:ro`).
4. **Working directory** — set to the worktree path via `-w`.
5. **Image** — auto-resolved from the agent name or overridden by `dockerImage` config.

The container is ephemeral (`--rm`) — it is created fresh for each agent invocation and removed on exit. The runner streams stdout/stderr from the container the same way it does from a local process, so progress extraction and IPC broadcasting work unchanged.

## Auto-detection

When no explicit `sandbox` value is configured (via config file, env var, or CLI flag), Ralphai probes Docker availability at startup by running `docker info` with a 3-second timeout. The result is cached for the process lifetime.

- **Docker available** → `sandbox` defaults to `"docker"` (source: `auto-detected`)
- **Docker unavailable** → `sandbox` defaults to `"none"` (source: `auto-detected`)

The behavior differs when Docker becomes unavailable after config resolution:

- **Explicit `sandbox: "docker"`** (set in config/env/CLI) → hard fail with `process.exit(1)` and an actionable error message
- **Auto-detected `sandbox: "docker"`** → silent fallback to `"none"` (local execution)

Use `ralphai config` to see the resolved value and its source.

## Credential forwarding

Credential forwarding follows a strict allowlist — only explicitly listed env vars and file paths are forwarded, preventing full `process.env` leakage into the container.

**Env vars** are forwarded per-agent:

| Agent    | Agent-specific vars | Common vars (all agents)   |
| -------- | ------------------- | -------------------------- |
| Claude   | `ANTHROPIC_API_KEY` | `GITHUB_TOKEN`, `GH_TOKEN` |
| Codex    | `OPENAI_API_KEY`    | `GITHUB_TOKEN`, `GH_TOKEN` |
| Gemini   | `GEMINI_API_KEY`    | `GITHUB_TOKEN`, `GH_TOKEN` |
| Aider    | `OPENAI_API_KEY`    | `GITHUB_TOKEN`, `GH_TOKEN` |
| Goose    | `OPENAI_API_KEY`    | `GITHUB_TOKEN`, `GH_TOKEN` |
| OpenCode | _(none)_            | `GITHUB_TOKEN`, `GH_TOKEN` |

Git identity vars (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`) are also forwarded when set on the host. Additional env vars can be forwarded via the `dockerEnvVars` config key.

Env vars that are unset or empty on the host are silently skipped.

### Build-tool cache env vars

Ralphai automatically sets the following env vars in every Docker sandbox container to keep build-tool caches inside the worktree. Without these, tools like Turborepo and Nx may resolve their cache directories to the parent repo (outside the container), causing permission errors.

| Env var              | Value       | Tool      |
| -------------------- | ----------- | --------- |
| `TURBO_CACHE_DIR`    | `.turbo`    | Turborepo |
| `NX_CACHE_DIRECTORY` | `.nx/cache` | Nx        |

Values are relative paths resolved against the container working directory (the worktree root). These vars are harmless when the corresponding tool is not present.

To override a value, set the same variable in `dockerEnvVars` in your config file — Docker processes `-e` flags left-to-right, so user-supplied values take precedence.

**File mounts** are forwarded per-agent as read-only bind mounts:

| Agent    | Mounted files (relative to `~`)                              |
| -------- | ------------------------------------------------------------ |
| OpenCode | `.local/share/opencode/auth.json`, `.config/github-copilot/` |
| All      | `.gitconfig`, `.agents/skills/`                              |

Files that don't exist on the host are silently skipped. Globally-installed skills (via `npx skills add ... -g`) are automatically available to agents in Docker mode through the `.agents/skills/` mount. Additional mounts can be added via the `dockerMounts` config key.

## Host runtime forwarding

When the agent needs to build or run Docker containers (e.g., for Testcontainers-based integration tests), it must communicate with a Docker or Podman daemon. The `docker.hostRuntime` config key controls whether the host's container runtime socket is forwarded into the sandbox container.

**Config key:** `docker.hostRuntime` (default: `false`)

```yaml
# ralphai.yaml
docker:
  hostRuntime: true
```

Or via CLI flag: `--docker-host-runtime` / `--no-docker-host-runtime`
Or via env var: `RALPHAI_DOCKER_HOST_RUNTIME=true`

### How it works

When `docker.hostRuntime` is `true`, Ralphai detects the host's container runtime socket using the following search order:

1. **`DOCKER_HOST` env var** — if set:
   - `unix:///path/to/socket` → extracts the socket path and bind-mounts it
   - `tcp://host:port` or `npipe://...` → forwards `DOCKER_HOST` as an env var (no socket mount)
2. **Default socket paths** (probed in order, first existing file wins):
   - `/var/run/docker.sock` (Docker daemon)
   - `$XDG_RUNTIME_DIR/podman/podman.sock` (Podman rootless)
   - `$HOME/.docker/run/docker.sock` (Docker Desktop on macOS)

The detected socket is bind-mounted read-write at `/var/run/docker.sock` inside the container. Read-write access is required because the Docker client communicates with the daemon over this socket.

If no socket is found and `DOCKER_HOST` is not set, Ralphai emits a console warning and proceeds — the user may have a remote daemon configured through other means.

When `sandbox` is `"none"`, the `docker.hostRuntime` setting is ignored (the agent already has direct access to the host environment).

### Security implications

Forwarding the Docker socket grants the agent **full control over the host's Docker daemon**. This means the agent can:

- Create, start, stop, and remove any container on the host
- Pull and push images
- Mount arbitrary host directories into new containers
- Access the host network

Only enable `docker.hostRuntime` when you trust the agent's workload and understand the risks. In CI environments, consider using a dedicated Docker daemon or a Docker-in-Docker (DinD) sidecar instead.

## Pre-built images

Ralphai publishes pre-built Docker images for supported agents:

- `ghcr.io/mfaux/ralphai-sandbox:claude`
- `ghcr.io/mfaux/ralphai-sandbox:opencode`
- `ghcr.io/mfaux/ralphai-sandbox:codex`

Images are based on `debian:bookworm-slim` and include git, curl, Node.js (LTS), pnpm (via corepack), Bun, the Docker CLI, and the agent CLI. The Docker CLI is present but inert by default — it requires the host runtime socket to be forwarded into the container (via the `docker.hostRuntime` config key) to communicate with a Docker daemon. The image is auto-resolved from the agent command (e.g., `claude -p` → `:claude`). Unrecognized agents fall back to the `:latest` tag. Override with the `dockerImage` config key for custom images.

At the start of each run, Ralphai pulls the resolved image (`docker pull --quiet`) to ensure the local cache is up to date. The pull is fail-open: if it fails (e.g., no network), the run continues with whatever image is cached locally.

## Stdio-based progress extraction

Because the container's stdout and stderr are piped back to the runner process, all existing progress extraction, learnings extraction, context extraction, and completion sentinel detection work unchanged. The `<progress>`, `<learnings>`, `<context>`, `<promise>`, and `<pr-summary>` sentinel tags are parsed from the container's output stream the same way they are parsed from a local process.

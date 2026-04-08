/**
 * DockerExecutor — runs the agent inside an ephemeral Docker container.
 *
 * Constructs a `docker run --rm` command with:
 * - Worktree bind-mounted at host path
 * - Per-agent credential env vars and file mounts
 * - Git identity env vars
 * - Custom user-supplied env vars and mounts from config
 * - Image auto-resolved from agent name or overridden by config
 *
 * Credential forwarding follows a strict allowlist — only explicitly
 * listed env vars are forwarded, preventing full process.env leakage.
 * File mounts and env vars are silently skipped when absent on the host.
 */

import { spawn, type ChildProcess } from "child_process";
import { createWriteStream } from "fs";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";

import { shellSplit } from "../runner.ts";
import { detectAgentType } from "../show-config.ts";

// ---------------------------------------------------------------------------
// Image resolution
// ---------------------------------------------------------------------------

/** Default image registry prefix. */
const IMAGE_REGISTRY = "ghcr.io/mfaux/ralphai-sandbox";

/**
 * Resolve the Docker image for a given agent command.
 *
 * If `dockerImage` is provided (non-empty), it is used as-is.
 * Otherwise the image is auto-resolved from the agent command:
 *   "claude -p" → "ghcr.io/mfaux/ralphai-sandbox:claude"
 *
 * Falls back to the "latest" tag for unrecognized agents.
 */
export function resolveDockerImage(
  agentCommand: string,
  dockerImage?: string,
): string {
  if (dockerImage) return dockerImage;
  const agentType = detectAgentType(agentCommand);
  const tag = agentType === "unknown" ? "latest" : agentType;
  return `${IMAGE_REGISTRY}:${tag}`;
}

// ---------------------------------------------------------------------------
// Credential forwarding
// ---------------------------------------------------------------------------

/** Per-agent env vars that should be forwarded into the container. */
const AGENT_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY"],
  opencode: [],
  codex: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  aider: ["OPENAI_API_KEY"],
  goose: ["OPENAI_API_KEY"],
  kiro: [],
  amp: [],
};

/** Common env vars forwarded for all agents. */
const COMMON_ENV_VARS: readonly string[] = ["GITHUB_TOKEN", "GH_TOKEN"];

/** Git identity env vars forwarded when set. */
const GIT_IDENTITY_VARS: readonly string[] = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
];

/** Per-agent file paths (relative to home) to mount read-only. */
const AGENT_FILE_MOUNTS: Readonly<Record<string, readonly string[]>> = {
  claude: [],
  opencode: [".local/share/opencode/auth.json", ".config/github-copilot/"],
  codex: [],
  gemini: [],
  aider: [],
  goose: [],
  kiro: [],
  amp: [],
};

/** Common file paths (relative to home) mounted read-only for all agents. */
const COMMON_FILE_MOUNTS: readonly string[] = [".gitconfig"];

/**
 * Build the list of `-e VAR` flags for env var forwarding.
 *
 * Only includes vars that are actually set on the host (non-empty).
 * Uses `-e VAR` (without `=value`) so Docker reads from the host env.
 */
export function buildEnvFlags(
  agentType: string,
  extraEnvVars: string[],
  env: Record<string, string | undefined> = process.env,
): string[] {
  const flags: string[] = [];
  const vars = new Set<string>();

  // Agent-specific vars
  const agentVars = AGENT_ENV_VARS[agentType] ?? [];
  for (const v of agentVars) vars.add(v);

  // Common vars
  for (const v of COMMON_ENV_VARS) vars.add(v);

  // Git identity vars
  for (const v of GIT_IDENTITY_VARS) vars.add(v);

  // User-supplied extra vars
  for (const v of extraEnvVars) vars.add(v);

  // Only include vars that are set on the host
  for (const v of vars) {
    if (env[v] !== undefined && env[v] !== "") {
      flags.push("-e", v);
    }
  }

  return flags;
}

/**
 * Build the list of `-v host:container:ro` flags for file mounts.
 *
 * Only includes paths that actually exist on the host.
 * All credential mounts are read-only (`:ro` suffix).
 */
export function buildMountFlags(
  agentType: string,
  extraMounts: string[],
  home: string = homedir(),
): string[] {
  const flags: string[] = [];

  // Agent-specific file mounts
  const agentMounts = AGENT_FILE_MOUNTS[agentType] ?? [];
  for (const relPath of agentMounts) {
    const hostPath = join(home, relPath);
    if (existsSync(hostPath)) {
      const containerPath = join("/root", relPath);
      flags.push("-v", `${hostPath}:${containerPath}:ro`);
    }
  }

  // Common file mounts
  for (const relPath of COMMON_FILE_MOUNTS) {
    const hostPath = join(home, relPath);
    if (existsSync(hostPath)) {
      const containerPath = join("/root", relPath);
      flags.push("-v", `${hostPath}:${containerPath}:ro`);
    }
  }

  // User-supplied extra mounts (already absolute paths, pass through)
  for (const mount of extraMounts) {
    if (mount.trim()) {
      flags.push("-v", mount.trim());
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Docker availability checks
// ---------------------------------------------------------------------------

/** Result of a Docker availability check. */
export interface DockerCheckResult {
  available: boolean;
  /** Error message when Docker is not available. */
  error?: string;
}

/**
 * Check Docker availability.
 *
 * Returns an error message if Docker is not usable:
 * - Windows: Docker sandboxing not supported
 * - Not installed: suggests installation
 * - Daemon not running: suggests starting Docker
 *
 * Uses synchronous exec to keep the check simple and fast.
 */
export function checkDockerAvailability(
  platform: string = process.platform,
  execCheck?: (cmd: string) => boolean,
): DockerCheckResult {
  if (platform === "win32") {
    return {
      available: false,
      error:
        "Docker sandboxing is not supported on Windows. " +
        "Use sandbox='none' or run Ralphai in WSL.",
    };
  }

  // Default exec check uses child_process
  const check =
    execCheck ??
    ((cmd: string): boolean => {
      try {
        require("child_process").execSync(cmd, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        return true;
      } catch {
        return false;
      }
    });

  // Check if docker binary is available
  if (!check("docker --version")) {
    return {
      available: false,
      error:
        "Docker is not installed. Install Docker from https://docs.docker.com/get-docker/ " +
        "or use sandbox='none' to run without containerization.",
    };
  }

  // Check if Docker daemon is running
  if (!check("docker info")) {
    return {
      available: false,
      error:
        "Docker daemon is not running. Start Docker with 'sudo systemctl start docker' " +
        "or 'open -a Docker' (macOS), then retry.",
    };
  }

  return { available: true };
}

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

/** Options for building the docker run command. */
export interface DockerCommandOptions {
  /** The agent command string (e.g. "claude -p"). */
  agentCommand: string;
  /** The prompt to pass to the agent. */
  prompt: string;
  /** Working directory (worktree path) to bind-mount. */
  cwd: string;
  /** Override image name (empty = auto-resolve). */
  dockerImage?: string;
  /** Extra env vars to forward (from dockerEnvVars config). */
  dockerEnvVars?: string[];
  /** Extra bind mounts (from dockerMounts config). */
  dockerMounts?: string[];
  /** Optional nonce for RALPHAI_NONCE env var. */
  nonce?: string;
}

/**
 * Build the full `docker run` command arguments.
 *
 * Returns the argument array suitable for `spawn("docker", args)`.
 * The resulting command:
 * - Uses `--rm` to remove the container on exit
 * - Bind-mounts the worktree at its host path
 * - Sets the container working directory to the worktree path
 * - Forwards only allowlisted env vars
 * - Mounts credential files read-only
 * - Does NOT mount ~/.ralphai/
 */
export function buildDockerArgs(opts: DockerCommandOptions): string[] {
  const {
    agentCommand,
    prompt,
    cwd,
    dockerImage,
    dockerEnvVars = [],
    dockerMounts = [],
    nonce,
  } = opts;

  const agentType = detectAgentType(agentCommand);
  const image = resolveDockerImage(agentCommand, dockerImage);

  const args: string[] = ["run", "--rm"];

  // Worktree bind mount (read-write so the agent can modify files)
  args.push("-v", `${cwd}:${cwd}`);
  args.push("-w", cwd);

  // Env var forwarding
  const envFlags = buildEnvFlags(agentType, dockerEnvVars);
  args.push(...envFlags);

  // Nonce env var (set explicitly with value, not from host env)
  if (nonce) {
    args.push("-e", `RALPHAI_NONCE=${nonce}`);
  }

  // Credential file mounts
  const mountFlags = buildMountFlags(agentType, dockerMounts);
  args.push(...mountFlags);

  // Image
  args.push(image);

  // Agent command and prompt
  const parts = shellSplit(agentCommand);
  args.push(...parts, prompt);

  return args;
}

// ---------------------------------------------------------------------------
// Setup command construction
// ---------------------------------------------------------------------------

/** Options for building the docker run command for a setup command. */
export interface SetupDockerCommandOptions {
  /** The agent command string — used only for image resolution and credential selection. */
  agentCommand: string;
  /** The setup command to run (e.g. "bun install"). */
  setupCommand: string;
  /** Working directory (worktree path) to bind-mount. */
  cwd: string;
  /** Override image name (empty = auto-resolve). */
  dockerImage?: string;
  /** Extra env vars to forward (from dockerEnvVars config). */
  dockerEnvVars?: string[];
  /** Extra bind mounts (from dockerMounts config). */
  dockerMounts?: string[];
}

/**
 * Build the `docker run` command arguments for a setup command.
 *
 * Reuses the same image, env vars, and credential mounts as agent execution
 * so that platform-specific binaries (e.g., native npm modules) match the
 * container's OS/arch. The setup command is passed to `sh -c` as the
 * container entrypoint.
 */
export function buildSetupDockerArgs(
  opts: SetupDockerCommandOptions,
): string[] {
  const {
    agentCommand,
    setupCommand,
    cwd,
    dockerImage,
    dockerEnvVars = [],
    dockerMounts = [],
  } = opts;

  const agentType = detectAgentType(agentCommand);
  const image = resolveDockerImage(agentCommand, dockerImage);

  const args: string[] = ["run", "--rm"];

  // Worktree bind mount (read-write so setup can install dependencies)
  args.push("-v", `${cwd}:${cwd}`);
  args.push("-w", cwd);

  // Env var forwarding (same as agent execution)
  const envFlags = buildEnvFlags(agentType, dockerEnvVars);
  args.push(...envFlags);

  // Credential file mounts (same as agent execution)
  const mountFlags = buildMountFlags(agentType, dockerMounts);
  args.push(...mountFlags);

  // Image
  args.push(image);

  // Setup command via sh -c
  args.push("sh", "-c", setupCommand);

  return args;
}

/**
 * Format a docker run command for display (dry-run output).
 *
 * Returns the full command string with proper quoting for readability.
 */
export function formatDockerCommand(args: string[]): string {
  const quoted = args.map((a) => {
    if (/[\s"'\\]/.test(a) || a === "") {
      return `'${a.replace(/'/g, "'\\''")}'`;
    }
    return a;
  });
  return `docker ${quoted.join(" ")}`;
}

// ---------------------------------------------------------------------------
// DockerExecutor
// ---------------------------------------------------------------------------

/** Configuration for the DockerExecutor. */
export interface DockerExecutorConfig {
  /** Override image name (empty = auto-resolve from agent name). */
  dockerImage?: string;
  /** Extra env vars to forward (from dockerEnvVars config, CSV-parsed). */
  dockerEnvVars?: string[];
  /** Extra bind mounts (from dockerMounts config, CSV-parsed). */
  dockerMounts?: string[];
}

/**
 * Executes the agent command inside an ephemeral Docker container.
 *
 * Used when `sandbox` is `"docker"`. Each agent invocation creates a
 * fresh container that is automatically removed on exit (`--rm`).
 *
 * The worktree is bind-mounted at its host path so file references
 * in agent output remain valid. Credential env vars and files are
 * forwarded per-agent following a strict allowlist.
 */
export class DockerExecutor implements AgentExecutor {
  private readonly config: DockerExecutorConfig;

  constructor(config: DockerExecutorConfig = {}) {
    this.config = config;
  }

  async spawn(opts: ExecutorSpawnOptions): Promise<ExecutorSpawnResult> {
    const {
      agentCommand,
      prompt,
      iterationTimeout,
      cwd,
      outputLogPath,
      ipcBroadcast,
      nonce,
    } = opts;

    const dockerArgs = buildDockerArgs({
      agentCommand,
      prompt,
      cwd,
      dockerImage: this.config.dockerImage,
      dockerEnvVars: this.config.dockerEnvVars,
      dockerMounts: this.config.dockerMounts,
      nonce,
    });

    return new Promise((resolve) => {
      // Open a write stream for the agent output log (append mode).
      let logStream: ReturnType<typeof createWriteStream> | undefined;
      if (outputLogPath) {
        try {
          logStream = createWriteStream(outputLogPath, { flags: "a" });
        } catch {
          // Best-effort: if we can't open the log, continue without it
        }
      }

      let ac: AbortController | undefined;
      let timedOut = false;
      const spawnOpts: {
        cwd?: string;
        stdio: ["pipe", "pipe", "pipe"];
        signal?: AbortSignal;
      } = {
        stdio: ["pipe", "pipe", "pipe"],
      };

      if (iterationTimeout > 0) {
        ac = new AbortController();
        spawnOpts.signal = ac.signal;
        setTimeout(() => {
          timedOut = true;
          ac!.abort();
        }, iterationTimeout * 1000);
      }

      let child: ChildProcess;
      try {
        child = spawn("docker", dockerArgs, spawnOpts);
      } catch (err) {
        console.error(
          `Failed to spawn Docker container: ${err instanceof Error ? err.message : err}`,
        );
        logStream?.end();
        resolve({ output: "", exitCode: 1, timedOut: false });
        return;
      }

      // Close stdin so the agent knows no input is coming.
      child.stdin?.end();

      const chunks: Buffer[] = [];

      child.stdout?.on("data", (data: Buffer) => {
        process.stdout.write(data);
        logStream?.write(data);
        chunks.push(data);
        ipcBroadcast?.({
          type: "output",
          data: data.toString(),
          stream: "stdout",
        });
      });

      child.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(data);
        logStream?.write(data);
        chunks.push(data);
        ipcBroadcast?.({
          type: "output",
          data: data.toString(),
          stream: "stderr",
        });
      });

      child.on("close", (code) => {
        const output = Buffer.concat(chunks).toString("utf-8");
        if (logStream) {
          logStream.end(() => {
            resolve({ output, exitCode: code ?? 1, timedOut });
          });
        } else {
          resolve({ output, exitCode: code ?? 1, timedOut });
        }
      });

      child.on("error", (err) => {
        logStream?.end();
        if (timedOut) {
          const output = Buffer.concat(chunks).toString("utf-8");
          resolve({ output, exitCode: 124, timedOut: true });
        } else {
          console.error(`Docker container error: ${err.message}`);
          const output = Buffer.concat(chunks).toString("utf-8");
          resolve({ output, exitCode: 1, timedOut: false });
        }
      });
    });
  }
}

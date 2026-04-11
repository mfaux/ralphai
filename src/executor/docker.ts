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
import { createWriteStream, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";

import { shellSplit } from "../shell-split.ts";
import { detectAgentType } from "../show-config.ts";
import { resolveMainGitDir } from "../worktree/index.ts";
import { resolveAgentVerboseFlags } from "./agent-flags.ts";

// ---------------------------------------------------------------------------
// Container user and home directory
// ---------------------------------------------------------------------------

/**
 * Container home directory for the non-root agent user.
 *
 * All credential mounts, tool installations, and HOME-dependent config
 * use this path instead of /root. The directory is created with open
 * permissions in the Dockerfile so any UID can write to it.
 */
export const CONTAINER_HOME = "/home/agent";

/**
 * Get the `--user UID:GID` flag for running the container as the host user.
 *
 * Returns the flag pair when `process.getuid` and `process.getgid` are
 * available (POSIX — Linux/macOS). Returns an empty array on Windows
 * where these APIs do not exist.
 */
export function getUserFlag(): string[] {
  if (
    typeof process.getuid === "function" &&
    typeof process.getgid === "function"
  ) {
    return ["--user", `${process.getuid()}:${process.getgid()}`];
  }
  return [];
}

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

/**
 * Per-agent file paths (relative to home) to mount read-only.
 *
 * IMPORTANT: If a path here creates intermediate directories inside the
 * container's /home/agent tree (e.g. ".local/share/opencode/auth.json"
 * creates the "opencode/" dir), you must also pre-create that directory
 * in docker/Dockerfile so it exists with 1777 permissions. Otherwise
 * Docker's bind-mount setup creates it as root, shadowing the writable
 * parent and causing EACCES for the non-root container user.
 */
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
const COMMON_FILE_MOUNTS: readonly string[] = [".gitconfig", ".agents/skills/"];

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

  // Agent-specific + common file mounts (read-only)
  const agentMounts = AGENT_FILE_MOUNTS[agentType] ?? [];
  for (const relPath of [...agentMounts, ...COMMON_FILE_MOUNTS]) {
    const hostPath = join(home, relPath);
    if (existsSync(hostPath)) {
      const containerPath = join(CONTAINER_HOME, relPath);
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
// Image pull
// ---------------------------------------------------------------------------

/** Result of a Docker image pull attempt. */
export interface DockerPullResult {
  /** Whether the pull succeeded. */
  success: boolean;
  /** The image that was pulled (or attempted). */
  image: string;
  /** Error message on failure. */
  error?: string;
}

/**
 * Pull the Docker image to ensure the local cache is up to date.
 *
 * Runs `docker pull --quiet <image>` synchronously. This is fail-open:
 * if the pull fails (e.g. no network), the run continues with whatever
 * image is cached locally. This avoids blocking offline use while still
 * keeping images fresh when connectivity is available.
 */
export function pullDockerImage(
  agentCommand: string,
  dockerImage?: string,
): DockerPullResult {
  const image = resolveDockerImage(agentCommand, dockerImage);

  try {
    require("child_process").execSync(`docker pull --quiet ${image}`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, image };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error during docker pull";
    return { success: false, image, error: message };
  }
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
  /**
   * Absolute path to the main repo's `.git` directory.
   * Required when the working directory is a git worktree so that
   * git operations inside the container can follow the worktree's
   * `.git` file pointer back to the main repo. Mounted read-write
   * because agents need to create commits.
   */
  mainGitDir?: string;
  /**
   * Optional absolute path to the feedback wrapper script on the host.
   *
   * When set, the script is bind-mounted read-only into the container
   * at the same path so the agent can invoke it. Without this, the
   * script lives in pipeline state (~/.ralphai/…) which is not mounted.
   */
  feedbackWrapperPath?: string;
  /** Extra flags to inject between the agent command and the prompt (for verbose mode). */
  extraAgentFlags?: string[];
}

/**
 * Build the common prefix of a `docker run` command: container flags,
 * worktree mount, env forwarding, credential mounts, and image.
 *
 * Both `buildDockerArgs` and `buildSetupDockerArgs` delegate here for
 * the shared portion, then append their own tail (agent command vs
 * setup command).
 */
function buildCommonDockerArgs(opts: {
  agentCommand: string;
  cwd: string;
  dockerImage?: string;
  dockerEnvVars?: string[];
  dockerMounts?: string[];
  mainGitDir?: string;
  feedbackWrapperPath?: string;
}): string[] {
  const {
    agentCommand,
    cwd,
    dockerImage,
    dockerEnvVars = [],
    dockerMounts = [],
    mainGitDir,
    feedbackWrapperPath,
  } = opts;

  const agentType = detectAgentType(agentCommand);
  const image = resolveDockerImage(agentCommand, dockerImage);

  const args: string[] = ["run", "--rm"];

  // Run as host user to avoid root-owned files in worktree
  args.push(...getUserFlag());

  // Set container HOME so tools and configs work for non-root user
  args.push("-e", `HOME=${CONTAINER_HOME}`);

  // Worktree bind mount (read-write)
  args.push("-v", `${cwd}:${cwd}`);
  args.push("-w", cwd);

  // Main .git directory mount for worktrees (read-write — needed for commits)
  if (mainGitDir) {
    args.push("-v", `${mainGitDir}:${mainGitDir}`);
  }

  // Feedback wrapper script: lives in pipeline state (~/.ralphai/…)
  // which is not otherwise mounted. Bind-mount the single file
  // read-only so the agent can invoke it from inside the container.
  if (feedbackWrapperPath && existsSync(feedbackWrapperPath)) {
    args.push("-v", `${feedbackWrapperPath}:${feedbackWrapperPath}:ro`);
  }

  // Env var forwarding
  args.push(...buildEnvFlags(agentType, dockerEnvVars));

  // Credential file mounts
  args.push(...buildMountFlags(agentType, dockerMounts));

  // Image
  args.push(image);

  return args;
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
    mainGitDir,
    feedbackWrapperPath,
    extraAgentFlags = [],
  } = opts;

  const args = buildCommonDockerArgs({
    agentCommand,
    cwd,
    dockerImage,
    dockerEnvVars,
    dockerMounts,
    mainGitDir,
    feedbackWrapperPath,
  });

  // Nonce env var (set explicitly with value, not from host env).
  // Inserted before the image (second-to-last position in the common args)
  // so it appears in the docker flags section.
  if (nonce) {
    const imageIdx = args.length - 1;
    args.splice(imageIdx, 0, "-e", `RALPHAI_NONCE=${nonce}`);
  }

  // Agent command and prompt
  const parts = shellSplit(agentCommand);
  args.push(...parts, ...extraAgentFlags, prompt);

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
  /**
   * Absolute path to the main repo's `.git` directory.
   * Required when the working directory is a git worktree so that
   * git operations inside the container can follow the worktree's
   * `.git` file pointer back to the main repo. Mounted read-write
   * because setup commands may need git access.
   */
  mainGitDir?: string;
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
    mainGitDir,
  } = opts;

  const args = buildCommonDockerArgs({
    agentCommand,
    cwd,
    dockerImage,
    dockerEnvVars,
    dockerMounts,
    mainGitDir,
  });

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
  /**
   * Path to the main repo's `.git` directory for worktree support.
   * When the agent's working directory is a git worktree, this path
   * must be mounted so git operations inside the container can resolve
   * the object store, refs, and config from the main repository.
   * Derived by the caller from `resolveWorktreeInfo()`.
   */
  mainGitDir?: string;
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
 *
 * When the working directory is a git worktree, the main repo's
 * `.git` directory is automatically mounted so git operations work.
 */
export class DockerExecutor implements AgentExecutor {
  private readonly config: DockerExecutorConfig;

  constructor(config: DockerExecutorConfig = {}) {
    this.config = config;
  }

  /**
   * Build the Docker args for a spawn invocation.
   *
   * Exposed for testing — allows verifying the constructed command
   * without actually spawning a Docker process.
   */
  buildSpawnDockerArgs(opts: {
    agentCommand: string;
    prompt: string;
    cwd: string;
    nonce?: string;
    feedbackWrapperPath?: string;
    verbose?: boolean;
    agentVerboseFlags?: string;
  }): string[] {
    const mainGitDir = resolveMainGitDir(opts.cwd);

    const extraAgentFlags = opts.verbose
      ? resolveAgentVerboseFlags(opts.agentCommand, opts.agentVerboseFlags)
      : [];

    return buildDockerArgs({
      agentCommand: opts.agentCommand,
      prompt: opts.prompt,
      cwd: opts.cwd,
      dockerImage: this.config.dockerImage,
      dockerEnvVars: this.config.dockerEnvVars,
      dockerMounts: this.config.dockerMounts,
      nonce: opts.nonce,
      mainGitDir,
      feedbackWrapperPath: opts.feedbackWrapperPath,
      extraAgentFlags,
    });
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
      feedbackWrapperPath,
      verbose,
      agentVerboseFlags,
    } = opts;

    const dockerArgs = this.buildSpawnDockerArgs({
      agentCommand,
      prompt,
      cwd,
      nonce,
      feedbackWrapperPath,
      verbose,
      agentVerboseFlags,
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

/**
 * Detect container-runtime errors in feedback command output.
 *
 * Pattern-matches against known Docker, Podman, and Testcontainers error
 * strings and returns an actionable advisory message when a match is found.
 */

// ---------------------------------------------------------------------------
// Error patterns (case-insensitive substring match)
// ---------------------------------------------------------------------------

const CONTAINER_RUNTIME_PATTERNS: string[] = [
  "could not find a working container runtime strategy", // Testcontainers
  "cannot connect to the docker daemon", // Docker CLI
  "cannot connect to podman", // Podman
];

// ---------------------------------------------------------------------------
// Sandbox context for advisory message adaptation
// ---------------------------------------------------------------------------

/** Context about the current sandbox configuration. */
export interface SandboxContext {
  /** Current sandbox mode ("none" or "docker"). */
  sandbox: "none" | "docker";
  /** Whether docker.hostRuntime is enabled. */
  hostRuntime: boolean;
}

// ---------------------------------------------------------------------------
// Detection function
// ---------------------------------------------------------------------------

/**
 * Detect whether feedback output contains a container-runtime error and
 * return an actionable advisory message, or `null` if no match is found.
 *
 * The advisory adapts based on the sandbox context:
 * - `sandbox=none`: generic message (hostRuntime is not relevant).
 * - `sandbox=docker` with `hostRuntime=false`: suggests enabling `docker.hostRuntime`.
 * - `sandbox=docker` with `hostRuntime=true`: suggests checking socket availability.
 *
 * @param output - Combined stdout/stderr from a feedback command.
 * @param context - Optional sandbox configuration context. Defaults to docker sandbox
 *   with hostRuntime disabled (the most common case where this advisory is useful).
 * @returns An advisory string, or `null` if no container-runtime error is detected.
 */
export function detectContainerRuntimeError(
  output: string,
  context?: SandboxContext,
): string | null {
  const lower = output.toLowerCase();
  const matched = CONTAINER_RUNTIME_PATTERNS.some((p) => lower.includes(p));
  if (!matched) return null;

  const ctx: SandboxContext = context ?? {
    sandbox: "docker",
    hostRuntime: false,
  };

  if (ctx.sandbox === "none") {
    return "[Advisory] This failure may be caused by a missing container runtime. Ensure Docker or Podman is installed and running on the host. See docs/docker.md for details.";
  }

  if (ctx.hostRuntime) {
    return "[Advisory] This failure may be caused by an unavailable container runtime socket inside the sandbox. docker.hostRuntime is enabled — verify that the host Docker/Podman daemon is running and the socket is accessible. See docs/docker.md for details.";
  }

  return "[Advisory] This failure may be caused by a missing container runtime inside the sandbox. Enable docker.hostRuntime in ralphai.json to forward the host Docker/Podman socket. See docs/docker.md for details.";
}

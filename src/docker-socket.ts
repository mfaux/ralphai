/**
 * Pure socket auto-detection for host Docker/Podman runtime forwarding.
 *
 * Resolves the host container runtime socket path by checking DOCKER_HOST
 * first, then probing well-known default socket locations. Designed to be
 * fully testable: all I/O is abstracted through callback parameters.
 */

/** Result of socket auto-detection. */
export interface SocketDetectionResult {
  /** Absolute path to the socket file, or null if no socket was found. */
  socketPath: string | null;
  /**
   * Whether DOCKER_HOST should be forwarded as an environment variable
   * into the container (true for tcp:// and npipe:// schemes where no
   * socket file is mounted).
   */
  forwardDockerHost: boolean;
}

/**
 * Build the list of default socket paths to probe, expanding environment
 * variables and home directory references.
 */
function buildDefaultPaths(env: Record<string, string | undefined>): string[] {
  const paths = ["/var/run/docker.sock"];

  // Podman user socket: $XDG_RUNTIME_DIR/podman/podman.sock
  const xdgRuntime = env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    paths.push(`${xdgRuntime}/podman/podman.sock`);
  }

  // Docker Desktop / colima user socket: ~/.docker/run/docker.sock
  const home = env.HOME;
  if (home) {
    paths.push(`${home}/.docker/run/docker.sock`);
  }

  return paths;
}

/**
 * Detect the host Docker/Podman socket path.
 *
 * Detection order:
 * 1. Parse `DOCKER_HOST` from the environment:
 *    - `unix://` scheme → extract the path and verify it exists.
 *    - `tcp://` or `npipe://` scheme → no socket mount, but forward the env var.
 * 2. If no `DOCKER_HOST`, probe default paths in order.
 * 3. First existing path wins.
 *
 * @param env - Environment variables (typically `process.env`).
 * @param fileExists - Callback that returns true if a filesystem path exists.
 *   Abstracts away `fs.existsSync` for testability.
 * @returns Detection result with socket path and forwarding flag.
 */
export function detectHostSocket(
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean,
): SocketDetectionResult {
  const dockerHost = env.DOCKER_HOST;

  if (dockerHost) {
    // Parse the scheme
    if (dockerHost.startsWith("unix://")) {
      const socketPath = dockerHost.slice("unix://".length);
      if (socketPath && fileExists(socketPath)) {
        return { socketPath, forwardDockerHost: false };
      }
      // unix:// path doesn't exist — fall through to defaults
    } else if (
      dockerHost.startsWith("tcp://") ||
      dockerHost.startsWith("npipe://")
    ) {
      // Remote or Windows named-pipe host — no socket to mount,
      // but forward DOCKER_HOST so the in-container client connects correctly.
      return { socketPath: null, forwardDockerHost: true };
    }
    // Unknown scheme or empty — fall through to default probing
  }

  // Probe default socket paths
  const defaults = buildDefaultPaths(env);
  for (const candidate of defaults) {
    if (fileExists(candidate)) {
      return { socketPath: candidate, forwardDockerHost: false };
    }
  }

  return { socketPath: null, forwardDockerHost: false };
}

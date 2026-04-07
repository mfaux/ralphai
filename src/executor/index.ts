/**
 * Executor factory and barrel exports.
 *
 * `createExecutor()` returns the appropriate `AgentExecutor` based on
 * the `sandbox` config value. `"none"` returns a `LocalExecutor`,
 * `"docker"` returns a `DockerExecutor` with the provided config.
 */

export type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";
export { LocalExecutor } from "./local.ts";
export {
  DockerExecutor,
  checkDockerAvailability,
  buildDockerArgs,
  formatDockerCommand,
  resolveDockerImage,
  buildEnvFlags,
  buildMountFlags,
  type DockerCheckResult,
  type DockerExecutorConfig,
  type DockerCommandOptions,
} from "./docker.ts";

import type { AgentExecutor } from "./types.ts";
import { LocalExecutor } from "./local.ts";
import { DockerExecutor, type DockerExecutorConfig } from "./docker.ts";

/**
 * Create an executor based on the sandbox configuration value.
 *
 * @param sandbox — The resolved sandbox mode (`"none"` or `"docker"`).
 * @param dockerConfig — Docker-specific config (image, mounts, env vars).
 * @returns An `AgentExecutor` implementation.
 */
export function createExecutor(
  sandbox: string,
  dockerConfig?: DockerExecutorConfig,
): AgentExecutor {
  switch (sandbox) {
    case "none":
      return new LocalExecutor();
    case "docker":
      return new DockerExecutor(dockerConfig);
    default:
      throw new Error(`Unknown sandbox mode: '${sandbox}'`);
  }
}

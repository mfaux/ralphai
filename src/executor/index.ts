/**
 * Executor factory and barrel exports.
 *
 * `createExecutor()` returns the appropriate `AgentExecutor` based on
 * the `sandbox` config value. Currently only `"none"` is supported,
 * which returns a `LocalExecutor`. The `"docker"` variant will be
 * added in a future slice.
 */

export type {
  AgentExecutor,
  ExecutorSpawnOptions,
  ExecutorSpawnResult,
} from "./types.ts";
export { LocalExecutor } from "./local.ts";

import type { AgentExecutor } from "./types.ts";
import { LocalExecutor } from "./local.ts";

/**
 * Create an executor based on the sandbox configuration value.
 *
 * @param sandbox — The resolved sandbox mode (`"none"` or `"docker"`).
 * @returns An `AgentExecutor` implementation.
 * @throws If `sandbox` is `"docker"` (not yet implemented).
 */
export function createExecutor(sandbox: string): AgentExecutor {
  switch (sandbox) {
    case "none":
      return new LocalExecutor();
    case "docker":
      throw new Error(
        "Docker executor is not yet implemented. Use sandbox='none' or omit the --sandbox flag.",
      );
    default:
      throw new Error(`Unknown sandbox mode: '${sandbox}'`);
  }
}

/**
 * Shared utilities from the interactive module.
 *
 * ExitIntercepted is used by test-utils.ts to intercept process.exit
 * calls during in-process CLI tests.
 */

/**
 * Sentinel error thrown when `process.exit` is intercepted.
 * Used to prevent delegated commands from killing test processes.
 */
export class ExitIntercepted extends Error {
  constructor() {
    super("process.exit intercepted");
    this.name = "ExitIntercepted";
  }
}

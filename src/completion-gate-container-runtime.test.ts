/**
 * Tests for container-runtime error detection integrated into the
 * completion gate. Verifies that the advisory appears in gate rejection
 * details when feedback fails with a container-runtime error, and does
 * not appear for unrelated failures.
 */
import { describe, test, expect } from "bun:test";

import {
  checkCompletionGate,
  type CompletionGateInput,
} from "./completion-gate.ts";
import type { SandboxContext } from "./container-runtime-error.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dockerCtx: SandboxContext = { sandbox: "docker", hostRuntime: false };
const dockerHostRuntimeCtx: SandboxContext = {
  sandbox: "docker",
  hostRuntime: true,
};
const noneCtx: SandboxContext = { sandbox: "none", hostRuntime: false };

function gateInput(
  overrides: Partial<CompletionGateInput>,
): CompletionGateInput {
  return {
    completedTasks: 5,
    totalTasks: 5,
    feedbackResults: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Advisory appears in gate rejection details
// ---------------------------------------------------------------------------

describe("checkCompletionGate — container-runtime advisory", () => {
  test("appends advisory when feedback fails with Docker daemon error", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "Error: Cannot connect to the Docker daemon",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
      expect(advisory).toContain("docker.hostRuntime");
    }
  });

  test("appends advisory when feedback fails with Testcontainers error", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "Could not find a working container runtime strategy",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
    }
  });

  test("appends advisory when feedback fails with Podman error", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "cannot connect to podman",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
    }
  });

  test("does NOT append advisory for unrelated failures", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "TypeError: Cannot read properties of undefined",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeUndefined();
    }
  });

  test("advisory adapts to sandbox=none context", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "Cannot connect to the Docker daemon",
          },
        ],
        sandboxContext: noneCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
      expect(advisory).not.toContain("docker.hostRuntime");
    }
  });

  test("advisory adapts when hostRuntime is already enabled", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "Cannot connect to the Docker daemon",
          },
        ],
        sandboxContext: dockerHostRuntimeCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
      expect(advisory).toContain("docker.hostRuntime is enabled");
    }
  });

  test("only one advisory even with multiple container-runtime failures", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test:integration",
            exitCode: 1,
            output: "Cannot connect to the Docker daemon",
          },
          {
            command: "bun run test:e2e",
            exitCode: 1,
            output: "cannot connect to podman",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisories = result.details.filter((d) =>
        d.startsWith("[Advisory]"),
      );
      expect(advisories).toHaveLength(1);
    }
  });

  test("no advisory when no sandboxContext is provided (defaults via detector)", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 1,
            output: "Cannot connect to the Docker daemon",
          },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      const advisory = result.details.find((d) => d.startsWith("[Advisory]"));
      expect(advisory).toBeDefined();
      expect(advisory).toContain("docker.hostRuntime");
    }
  });

  test("no advisory when feedback commands pass", () => {
    const result = checkCompletionGate(
      gateInput({
        feedbackResults: [
          {
            command: "bun run test",
            exitCode: 0,
            output: "",
          },
        ],
        sandboxContext: dockerCtx,
      }),
    );
    expect(result.passed).toBe(true);
  });
});

import { describe, expect, it } from "bun:test";

import {
  detectContainerRuntimeError,
  type SandboxContext,
} from "./container-runtime-error.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dockerCtx: SandboxContext = { sandbox: "docker", hostRuntime: false };
const dockerWithRuntimeCtx: SandboxContext = {
  sandbox: "docker",
  hostRuntime: true,
};
const noneCtx: SandboxContext = { sandbox: "none", hostRuntime: false };

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

describe("detectContainerRuntimeError", () => {
  describe("Testcontainers error pattern", () => {
    it("detects exact Testcontainers error", () => {
      const output =
        "org.testcontainers.DockerClientException: Could not find a working container runtime strategy";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });

    it("detects case variation", () => {
      const output = "COULD NOT FIND A WORKING CONTAINER RUNTIME STRATEGY";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });
  });

  describe("Docker CLI error pattern", () => {
    it("detects Docker daemon connection error", () => {
      const output =
        "ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });

    it("detects case variation", () => {
      const output = "cannot connect to the docker daemon";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });
  });

  describe("Podman error pattern", () => {
    it("detects Podman connection error", () => {
      const output = "Error: cannot connect to Podman. Is Podman running?";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });

    it("detects case variation", () => {
      const output = "CANNOT CONNECT TO PODMAN";
      expect(detectContainerRuntimeError(output, dockerCtx)).toBeString();
    });
  });

  describe("unrelated errors return null", () => {
    it("returns null for type errors", () => {
      expect(
        detectContainerRuntimeError(
          "TypeError: undefined is not a function",
          dockerCtx,
        ),
      ).toBeNull();
    });

    it("returns null for test assertion failures", () => {
      expect(
        detectContainerRuntimeError(
          "Expected 3 to equal 5\n  at Object.<anonymous>",
          dockerCtx,
        ),
      ).toBeNull();
    });

    it("returns null for build errors", () => {
      expect(
        detectContainerRuntimeError(
          "error TS2345: Argument of type 'string'",
          dockerCtx,
        ),
      ).toBeNull();
    });

    it("returns null for empty output", () => {
      expect(detectContainerRuntimeError("", dockerCtx)).toBeNull();
    });

    it("returns null for output mentioning docker in other contexts", () => {
      expect(
        detectContainerRuntimeError("Building docker image... done", dockerCtx),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Advisory message adaptation
  // ---------------------------------------------------------------------------

  describe("advisory adapts to sandbox context", () => {
    const output = "Cannot connect to the Docker daemon";

    it("suggests enabling hostRuntime when sandbox=docker and hostRuntime=false", () => {
      const msg = detectContainerRuntimeError(output, dockerCtx)!;
      expect(msg).toContain("docker.hostRuntime");
      expect(msg).toContain("Enable");
    });

    it("suggests checking socket when sandbox=docker and hostRuntime=true", () => {
      const msg = detectContainerRuntimeError(output, dockerWithRuntimeCtx)!;
      expect(msg).toContain("docker.hostRuntime is enabled");
      expect(msg).toContain("socket");
      expect(msg).not.toContain("Enable docker.hostRuntime");
    });

    it("omits hostRuntime advice when sandbox=none", () => {
      const msg = detectContainerRuntimeError(output, noneCtx)!;
      expect(msg).not.toContain("docker.hostRuntime");
      expect(msg).toContain("Ensure Docker or Podman is installed");
    });

    it("defaults to docker sandbox with hostRuntime=false when no context provided", () => {
      const msg = detectContainerRuntimeError(output)!;
      expect(msg).toContain("Enable docker.hostRuntime");
    });
  });

  // ---------------------------------------------------------------------------
  // Case insensitivity
  // ---------------------------------------------------------------------------

  describe("case insensitivity", () => {
    it("matches mixed case", () => {
      expect(
        detectContainerRuntimeError(
          "CaNnOt CoNnEcT tO tHe DoCkEr DaEmOn",
          dockerCtx,
        ),
      ).toBeString();
    });
  });
});

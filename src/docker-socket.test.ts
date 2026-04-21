import { describe, it, expect } from "bun:test";
import { detectHostSocket } from "./docker-socket.ts";

describe("detectHostSocket", () => {
  it("finds /var/run/docker.sock when it exists", () => {
    const result = detectHostSocket({}, (p) => p === "/var/run/docker.sock");
    expect(result.socketPath).toBe("/var/run/docker.sock");
    expect(result.forwardDockerHost).toBe(false);
  });

  it("parses DOCKER_HOST=unix:///path and checks the extracted path", () => {
    const result = detectHostSocket(
      { DOCKER_HOST: "unix:///custom/docker.sock" },
      (p) => p === "/custom/docker.sock",
    );
    expect(result.socketPath).toBe("/custom/docker.sock");
    expect(result.forwardDockerHost).toBe(false);
  });

  it("falls through to defaults when unix:// path does not exist", () => {
    const result = detectHostSocket(
      { DOCKER_HOST: "unix:///missing/docker.sock" },
      (p) => p === "/var/run/docker.sock",
    );
    expect(result.socketPath).toBe("/var/run/docker.sock");
    expect(result.forwardDockerHost).toBe(false);
  });

  it("handles DOCKER_HOST=tcp://host:port (no socket mount, forward env)", () => {
    const result = detectHostSocket(
      { DOCKER_HOST: "tcp://192.168.1.100:2375" },
      () => false,
    );
    expect(result.socketPath).toBeNull();
    expect(result.forwardDockerHost).toBe(true);
  });

  it("handles DOCKER_HOST=npipe:// (no socket mount, forward env)", () => {
    const result = detectHostSocket(
      { DOCKER_HOST: "npipe:////./pipe/docker_engine" },
      () => false,
    );
    expect(result.socketPath).toBeNull();
    expect(result.forwardDockerHost).toBe(true);
  });

  it("probes Podman user socket path via XDG_RUNTIME_DIR", () => {
    const result = detectHostSocket(
      { XDG_RUNTIME_DIR: "/run/user/1000" },
      (p) => p === "/run/user/1000/podman/podman.sock",
    );
    expect(result.socketPath).toBe("/run/user/1000/podman/podman.sock");
    expect(result.forwardDockerHost).toBe(false);
  });

  it("probes ~/.docker/run/docker.sock", () => {
    const result = detectHostSocket(
      { HOME: "/home/testuser" },
      (p) => p === "/home/testuser/.docker/run/docker.sock",
    );
    expect(result.socketPath).toBe("/home/testuser/.docker/run/docker.sock");
    expect(result.forwardDockerHost).toBe(false);
  });

  it("returns null when no socket is found", () => {
    const result = detectHostSocket({}, () => false);
    expect(result.socketPath).toBeNull();
    expect(result.forwardDockerHost).toBe(false);
  });

  it("prefers /var/run/docker.sock over Podman socket", () => {
    const existing = new Set([
      "/var/run/docker.sock",
      "/run/user/1000/podman/podman.sock",
    ]);
    const result = detectHostSocket(
      { XDG_RUNTIME_DIR: "/run/user/1000" },
      (p) => existing.has(p),
    );
    expect(result.socketPath).toBe("/var/run/docker.sock");
  });

  it("DOCKER_HOST unix:// takes priority over default paths", () => {
    const existing = new Set(["/custom/docker.sock", "/var/run/docker.sock"]);
    const result = detectHostSocket(
      { DOCKER_HOST: "unix:///custom/docker.sock" },
      (p) => existing.has(p),
    );
    expect(result.socketPath).toBe("/custom/docker.sock");
  });
});

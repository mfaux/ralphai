import { describe, it, expect } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import { detectSetupCommand } from "./project-detection.ts";

describe("detectSetupCommand", () => {
  const ctx = useTempDir();

  it("returns 'bun install' for bun lockfile", () => {
    writeFileSync(join(ctx.dir, "bun.lock"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    expect(detectSetupCommand(ctx.dir)).toBe("bun install");
  });

  it("returns 'pnpm install' for pnpm lockfile", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    expect(detectSetupCommand(ctx.dir)).toBe("pnpm install");
  });

  it("returns 'yarn install' for yarn lockfile", () => {
    writeFileSync(join(ctx.dir, "yarn.lock"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    expect(detectSetupCommand(ctx.dir)).toBe("yarn install");
  });

  it("returns 'npm install' for npm lockfile", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    expect(detectSetupCommand(ctx.dir)).toBe("npm install");
  });

  it("returns 'deno install' for deno lockfile", () => {
    writeFileSync(join(ctx.dir, "deno.lock"), "{}");
    writeFileSync(join(ctx.dir, "deno.json"), "{}");
    expect(detectSetupCommand(ctx.dir)).toBe("deno install");
  });

  it("returns 'dotnet restore' for .NET project", () => {
    writeFileSync(join(ctx.dir, "MyApp.csproj"), "<Project />");
    expect(detectSetupCommand(ctx.dir)).toBe("dotnet restore");
  });

  it("returns 'go mod download' for Go project", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/m\n");
    expect(detectSetupCommand(ctx.dir)).toBe("go mod download");
  });

  it("returns empty string for Rust project (no auto setup)", () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), "[package]\nname = 'test'\n");
    expect(detectSetupCommand(ctx.dir)).toBe("");
  });

  it("returns empty string for unknown project", () => {
    expect(detectSetupCommand(ctx.dir)).toBe("");
  });
});

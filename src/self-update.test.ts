import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";
import {
  detectInstallerPM,
  buildUpdateCommand,
  checkForUpdate,
} from "./self-update.ts";
import { compareVersions } from "./utils.ts";

describe("self-update", () => {
  it("detectInstallerPM returns pnpm for paths containing .pnpm", () => {
    expect(
      detectInstallerPM(
        "/home/user/.local/share/pnpm/global/5/.pnpm/ralphai@0.2.1/node_modules/ralphai/dist/cli.mjs",
      ),
    ).toBe("pnpm");
  });

  it("detectInstallerPM returns pnpm for Windows paths containing .pnpm", () => {
    expect(
      detectInstallerPM(
        "C:\\Users\\user\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\ralphai@0.2.1\\node_modules\\ralphai\\dist\\cli.mjs",
      ),
    ).toBe("pnpm");
  });

  it("detectInstallerPM returns bun for paths containing .bun", () => {
    expect(
      detectInstallerPM(
        "/home/user/.bun/install/global/node_modules/ralphai/dist/cli.mjs",
      ),
    ).toBe("bun");
  });

  it("detectInstallerPM returns yarn for paths containing yarn/global", () => {
    expect(
      detectInstallerPM(
        "/home/user/.config/yarn/global/node_modules/ralphai/dist/cli.mjs",
      ),
    ).toBe("yarn");
  });

  it("detectInstallerPM returns npm as fallback", () => {
    expect(
      detectInstallerPM("/usr/local/lib/node_modules/ralphai/dist/cli.mjs"),
    ).toBe("npm");
  });

  it("buildUpdateCommand builds correct command for each PM", () => {
    expect(buildUpdateCommand("pnpm", "ralphai", "latest")).toBe(
      "pnpm add -g ralphai@latest",
    );
    expect(buildUpdateCommand("npm", "ralphai", "latest")).toBe(
      "npm install -g ralphai@latest",
    );
    expect(buildUpdateCommand("yarn", "ralphai", "latest")).toBe(
      "yarn global add ralphai@latest",
    );
    expect(buildUpdateCommand("bun", "ralphai", "latest")).toBe(
      "bun add -g ralphai@latest",
    );
  });

  it("buildUpdateCommand includes tag in spec", () => {
    expect(buildUpdateCommand("npm", "ralphai", "beta")).toBe(
      "npm install -g ralphai@beta",
    );
    expect(buildUpdateCommand("pnpm", "ralphai", "next")).toBe(
      "pnpm add -g ralphai@next",
    );
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns positive when first is greater (major)", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
  });

  it("returns negative when first is less (minor)", () => {
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
  });

  it("returns positive when first is greater (patch)", () => {
    expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("handles versions with missing parts", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("update check cache", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `ralphai-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("checkForUpdate returns null when no cache file exists", () => {
    expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
  });

  it("checkForUpdate returns null when current version is latest", () => {
    writeFileSync(
      join(cacheDir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "1.0.0" }),
    );
    expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
  });

  it("checkForUpdate returns null when current version is newer", () => {
    writeFileSync(
      join(cacheDir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "1.0.0" }),
    );
    expect(checkForUpdate("ralphai", "2.0.0", cacheDir)).toBeNull();
  });

  it("checkForUpdate returns update info when newer version is available", () => {
    writeFileSync(
      join(cacheDir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "2.0.0" }),
    );
    const result = checkForUpdate("ralphai", "1.0.0", cacheDir);
    expect(result).toEqual({ latest: "2.0.0", current: "1.0.0" });
  });

  it("checkForUpdate returns null for corrupt cache file", () => {
    writeFileSync(join(cacheDir, "update-check.json"), "not json");
    expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
  });

  it("checkForUpdate returns null when cache has no latestVersion", () => {
    writeFileSync(
      join(cacheDir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now() }),
    );
    expect(checkForUpdate("ralphai", "1.0.0", cacheDir)).toBeNull();
  });
});

describe("update notification banner", () => {
  const ctx = useTempGitDir();
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = join(
      tmpdir(),
      `ralphai-notify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("shows update banner when newer version is cached", () => {
    // Write a cache file indicating a newer version
    const ralphaiHome = join(
      tmpdir(),
      `ralphai-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const cacheSubdir = join(ralphaiHome, "cache");
    mkdirSync(cacheSubdir, { recursive: true });
    writeFileSync(
      join(cacheSubdir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "99.0.0" }),
    );

    try {
      // Use "init --yes" which goes through main() where the
      // notification code path runs — requires subprocess.
      const result = runCli(["init", "--yes"], ctx.dir, {
        RALPHAI_HOME: ralphaiHome,
      });
      expect(result.stdout).toContain("Update available");
      expect(result.stdout).toContain("99.0.0");
      expect(result.stdout).toContain("ralphai update");
    } finally {
      if (existsSync(ralphaiHome)) {
        rmSync(ralphaiHome, { recursive: true, force: true });
      }
    }
  });

  it("does not show banner when RALPHAI_NO_UPDATE_CHECK is set", () => {
    const ralphaiHome = join(
      tmpdir(),
      `ralphai-home-nocheck-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const cacheSubdir = join(ralphaiHome, "cache");
    mkdirSync(cacheSubdir, { recursive: true });
    writeFileSync(
      join(cacheSubdir, "update-check.json"),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "99.0.0" }),
    );

    try {
      const result = runCli(["init", "--yes"], ctx.dir, {
        RALPHAI_HOME: ralphaiHome,
        RALPHAI_NO_UPDATE_CHECK: "1",
      });
      expect(result.stdout).not.toContain("Update available");
      expect(result.stdout).not.toContain("99.0.0");
    } finally {
      if (existsSync(ralphaiHome)) {
        rmSync(ralphaiHome, { recursive: true, force: true });
      }
    }
  });
});

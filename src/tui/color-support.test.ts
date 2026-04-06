/**
 * Tests for `src/tui/color-support.ts` — NO_COLOR / --no-color bridge.
 *
 * Tests the pure detection function (`shouldDisableColor`) and the
 * chalk level override (`applyNoColorOverride`).
 *
 * Also verifies the TUI color conventions documented in the plan:
 * - bold for group headers
 * - dim for disabled items and hints
 * - cursor indicator (❯) for current selection
 * - cyan for highlighted items
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import chalk from "chalk";
import { shouldDisableColor, applyNoColorOverride } from "./color-support.ts";

// ---------------------------------------------------------------------------
// shouldDisableColor
// ---------------------------------------------------------------------------

describe("shouldDisableColor", () => {
  it("returns false when NO_COLOR is not set and --no-color is absent", () => {
    expect(shouldDisableColor({}, ["node", "ralphai"])).toBe(false);
  });

  it("returns true when NO_COLOR is set to '1'", () => {
    expect(shouldDisableColor({ NO_COLOR: "1" }, ["node", "ralphai"])).toBe(
      true,
    );
  });

  it("returns true when NO_COLOR is set to empty string", () => {
    // NO_COLOR spec: presence alone is sufficient, regardless of value
    expect(shouldDisableColor({ NO_COLOR: "" }, ["node", "ralphai"])).toBe(
      true,
    );
  });

  it("returns true when NO_COLOR is set to 'true'", () => {
    expect(shouldDisableColor({ NO_COLOR: "true" }, ["node", "ralphai"])).toBe(
      true,
    );
  });

  it("returns true when --no-color flag is present", () => {
    expect(shouldDisableColor({}, ["node", "ralphai", "--no-color"])).toBe(
      true,
    );
  });

  it("returns true when both NO_COLOR and --no-color are present", () => {
    expect(
      shouldDisableColor({ NO_COLOR: "1" }, ["node", "ralphai", "--no-color"]),
    ).toBe(true);
  });

  it("ignores unrelated env vars", () => {
    expect(
      shouldDisableColor({ FORCE_COLOR: "0", TERM: "dumb" }, [
        "node",
        "ralphai",
      ]),
    ).toBe(false);
  });

  it("ignores --no-colors (only checks --no-color)", () => {
    // Our function checks --no-color specifically. --no-colors is a
    // different flag that chalk's supports-color handles separately.
    expect(shouldDisableColor({}, ["node", "ralphai", "--no-colors"])).toBe(
      false,
    );
  });

  it("does not match partial --no-color-xxx flags", () => {
    // Array.includes does exact match, so --no-color-xxx won't match
    expect(shouldDisableColor({}, ["node", "ralphai", "--no-color-xxx"])).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// applyNoColorOverride
// ---------------------------------------------------------------------------

describe("applyNoColorOverride", () => {
  let savedLevel: 0 | 1 | 2 | 3;

  beforeEach(() => {
    savedLevel = chalk.level;
  });

  afterEach(() => {
    chalk.level = savedLevel;
  });

  it("sets chalk.level to 0 when NO_COLOR is set", () => {
    chalk.level = 3; // start with full color support
    const previous = applyNoColorOverride({ NO_COLOR: "1" }, [
      "node",
      "ralphai",
    ]);
    expect(previous as number).toBe(3);
    expect(chalk.level as number).toBe(0);
  });

  it("sets chalk.level to 0 when --no-color is passed", () => {
    chalk.level = 2;
    const previous = applyNoColorOverride({}, [
      "node",
      "ralphai",
      "--no-color",
    ]);
    expect(previous as number).toBe(2);
    expect(chalk.level as number).toBe(0);
  });

  it("does not change chalk.level when color is enabled", () => {
    chalk.level = 3;
    const previous = applyNoColorOverride({}, ["node", "ralphai"]);
    expect(previous as number).toBe(3);
    expect(chalk.level as number).toBe(3);
  });

  it("returns 0 when chalk.level was already 0", () => {
    chalk.level = 0;
    const previous = applyNoColorOverride({ NO_COLOR: "1" }, [
      "node",
      "ralphai",
    ]);
    expect(previous as number).toBe(0);
    expect(chalk.level as number).toBe(0);
  });

  it("chalk produces plain text when level is 0", () => {
    chalk.level = 0;
    // With level 0, chalk should not add any ANSI escape codes
    expect(chalk.red("hello")).toBe("hello");
    expect(chalk.bold("hello")).toBe("hello");
    expect(chalk.dim("hello")).toBe("hello");
    expect(chalk.cyan("hello")).toBe("hello");
  });

  it("chalk produces colored text when level > 0", () => {
    chalk.level = 1;
    // With level > 0, chalk should add ANSI escape codes
    const colored = chalk.red("hello");
    expect(colored).not.toBe("hello");
    expect(colored).toContain("hello");
    // Should contain escape sequences
    expect(colored).toMatch(/\x1b\[/);
  });

  it("all TUI text styling methods produce plain text at level 0", () => {
    chalk.level = 0;
    // These are all the chalk methods used by Ink's <Text> component
    // for the TUI color conventions:
    // - bold (group headers)
    // - dim (disabled items, hints)
    // - cyan, gray, green, red, yellow (item colors)
    // - inverse (text input cursor)
    // - italic (options screen)
    // - underline (detail pane title)
    for (const method of [
      "bold",
      "dim",
      "italic",
      "underline",
      "inverse",
      "strikethrough",
      "cyan",
      "gray",
      "green",
      "red",
      "yellow",
    ] as const) {
      expect(chalk[method]("test")).toBe("test");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: applyNoColorOverride from runTui entry point
// ---------------------------------------------------------------------------

describe("color support integration", () => {
  let savedLevel: 0 | 1 | 2 | 3;

  beforeEach(() => {
    savedLevel = chalk.level;
  });

  afterEach(() => {
    chalk.level = savedLevel;
  });

  it("NO_COLOR=1 disables all Ink text styling via chalk", () => {
    chalk.level = 3;
    applyNoColorOverride({ NO_COLOR: "1" }, ["node", "ralphai"]);

    // Simulates what Ink's <Text bold> renders: chalk.bold(children)
    expect(chalk.bold("Pipeline: ")).toBe("Pipeline: ");

    // Simulates what Ink's <Text dimColor> renders: chalk.dim(children)
    expect(chalk.dim("loading…")).toBe("loading…");

    // Simulates what Ink's <Text color="cyan"> renders: chalk.cyan(children)
    expect(chalk.cyan("❯ Run next")).toBe("❯ Run next");

    // Simulates what Ink's <Text color="gray"> renders: chalk.gray(children)
    expect(chalk.gray("disabled item")).toBe("disabled item");
  });
});

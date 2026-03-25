import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("init wizard", () => {
  it("does not prompt for removed workflow options", () => {
    const source = readFileSync(join(__dirname, "ralphai.ts"), "utf-8");

    expect(source).not.toContain('message: "Workflow mode:"');
    expect(source).not.toContain('message: "Auto-commit between tasks?"');
  });
});

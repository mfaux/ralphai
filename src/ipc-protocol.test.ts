/**
 * Tests for the IPC protocol module.
 */

import { describe, test, expect } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import {
  serialize,
  deserialize,
  getSocketPath,
  type IpcMessage,
  type OutputMessage,
  type ProgressMessage,
  type ReceiptMessage,
  type CompleteMessage,
} from "./ipc-protocol.ts";

// ---------------------------------------------------------------------------
// serialize / deserialize round-trip
// ---------------------------------------------------------------------------

describe("serialize", () => {
  test("output message ends with newline", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "hello",
      stream: "stdout",
    };
    const s = serialize(msg);
    expect(s.endsWith("\n")).toBe(true);
    expect(s.split("\n").length).toBe(2); // content + trailing empty
  });

  test("output message round-trips", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "hello world",
      stream: "stderr",
    };
    const result = deserialize(serialize(msg));
    expect(result).toEqual(msg);
  });

  test("progress message round-trips", () => {
    const msg: ProgressMessage = {
      type: "progress",
      iteration: 3,
      content: "- [x] Implement feature A\n- [x] Add tests",
    };
    const result = deserialize(serialize(msg));
    expect(result).toEqual(msg);
  });

  test("receipt message round-trips", () => {
    const msg: ReceiptMessage = {
      type: "receipt",
      tasksCompleted: 5,
    };
    const result = deserialize(serialize(msg));
    expect(result).toEqual(msg);
  });

  test("complete message round-trips", () => {
    const msg: CompleteMessage = { type: "complete", planSlug: "my-plan" };
    const result = deserialize(serialize(msg));
    expect(result).toEqual(msg);
  });
});

// ---------------------------------------------------------------------------
// Special characters
// ---------------------------------------------------------------------------

describe("special characters", () => {
  test("preserves newlines embedded in data field", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "line1\nline2\nline3",
      stream: "stdout",
    };
    const serialized = serialize(msg);
    // The serialized form should be a single line (JSON escapes \n)
    const lines = serialized.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);

    const result = deserialize(serialized) as OutputMessage;
    expect(result.data).toBe("line1\nline2\nline3");
  });

  test("preserves unicode characters", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "Hello 🌍 \u2603 \u00e9\u00e8\u00ea",
      stream: "stdout",
    };
    const result = deserialize(serialize(msg)) as OutputMessage;
    expect(result.data).toBe(msg.data);
  });

  test("preserves quotes and backslashes", () => {
    const msg: OutputMessage = {
      type: "output",
      data: 'path "with quotes" and \\backslashes\\',
      stream: "stdout",
    };
    const result = deserialize(serialize(msg)) as OutputMessage;
    expect(result.data).toBe(msg.data);
  });

  test("preserves tabs and carriage returns", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "col1\tcol2\r\nwindows line",
      stream: "stdout",
    };
    const result = deserialize(serialize(msg)) as OutputMessage;
    expect(result.data).toBe(msg.data);
  });

  test("handles empty data string", () => {
    const msg: OutputMessage = { type: "output", data: "", stream: "stdout" };
    const result = deserialize(serialize(msg)) as OutputMessage;
    expect(result.data).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deserialize edge cases
// ---------------------------------------------------------------------------

describe("deserialize", () => {
  test("returns null for empty string", () => {
    expect(deserialize("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(deserialize("   \n  ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(deserialize("{invalid json}")).toBeNull();
  });

  test("returns null for JSON without type field", () => {
    expect(deserialize('{"data": "hello"}')).toBeNull();
  });

  test("returns null for JSON with non-string type field", () => {
    expect(deserialize('{"type": 42}')).toBeNull();
  });

  test("returns null for JSON array", () => {
    expect(deserialize('[{"type": "output"}]')).toBeNull();
  });

  test("returns null for JSON primitive", () => {
    expect(deserialize('"hello"')).toBeNull();
    expect(deserialize("42")).toBeNull();
    expect(deserialize("true")).toBeNull();
    expect(deserialize("null")).toBeNull();
  });

  test("handles leading/trailing whitespace", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "test",
      stream: "stdout",
    };
    const result = deserialize("  " + JSON.stringify(msg) + "  \n");
    expect(result).toEqual(msg);
  });

  test("accepts unknown type field values (forward compat)", () => {
    const result = deserialize('{"type": "future-type", "foo": "bar"}');
    expect(result).not.toBeNull();
    expect((result as any).type).toBe("future-type");
  });
});

// ---------------------------------------------------------------------------
// Multi-message parsing (simulating chunk processing)
// ---------------------------------------------------------------------------

describe("multi-message chunk parsing", () => {
  test("parses multiple messages from a concatenated chunk", () => {
    const msgs: IpcMessage[] = [
      { type: "output", data: "line 1", stream: "stdout" },
      { type: "output", data: "line 2", stream: "stderr" },
      { type: "progress", iteration: 1, content: "- [x] Task 1" },
    ];

    const chunk = msgs.map(serialize).join("");
    const lines = chunk.split("\n").filter((l) => l.length > 0);

    expect(lines.length).toBe(3);
    expect(deserialize(lines[0]!)).toEqual(msgs[0]!);
    expect(deserialize(lines[1]!)).toEqual(msgs[1]!);
    expect(deserialize(lines[2]!)).toEqual(msgs[2]!);
  });

  test("handles partial lines across chunk boundaries", () => {
    const msg: OutputMessage = {
      type: "output",
      data: "hello",
      stream: "stdout",
    };
    const full = serialize(msg);

    // Split in the middle of the JSON
    const splitPoint = Math.floor(full.length / 2);
    const chunk1 = full.slice(0, splitPoint);
    const chunk2 = full.slice(splitPoint);

    // chunk1 alone should not parse
    const lines1 = chunk1.split("\n").filter((l) => l.length > 0);
    for (const line of lines1) {
      // Partial JSON won't parse correctly
      const result = deserialize(line);
      // It's either null or not equal to the original (corrupted parse)
      if (result !== null) {
        expect(result).not.toEqual(msg);
      }
    }

    // Concatenated chunks should parse correctly
    const combined = chunk1 + chunk2;
    const lines = combined.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    expect(deserialize(lines[0]!)).toEqual(msg);
  });

  /**
   * Simulates a line-buffered parser that accumulates data across chunks.
   */
  test("line-buffered parsing across chunks", () => {
    const msgs: IpcMessage[] = [
      { type: "output", data: "first", stream: "stdout" },
      { type: "output", data: "second", stream: "stderr" },
    ];

    const full = msgs.map(serialize).join("");

    // Split into 3 chunks at arbitrary points
    const chunk1 = full.slice(0, 10);
    const chunk2 = full.slice(10, full.length - 5);
    const chunk3 = full.slice(full.length - 5);

    const parsed: IpcMessage[] = [];
    let buffer = "";

    for (const chunk of [chunk1, chunk2, chunk3]) {
      buffer += chunk;
      const lines = buffer.split("\n");
      // Keep the last element as incomplete line buffer
      buffer = lines.pop()!;
      for (const line of lines) {
        const msg = deserialize(line);
        if (msg) parsed.push(msg);
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const msg = deserialize(buffer);
      if (msg) parsed.push(msg);
    }

    expect(parsed).toEqual(msgs);
  });
});

// ---------------------------------------------------------------------------
// getSocketPath
// ---------------------------------------------------------------------------

describe("getSocketPath", () => {
  test("returns co-located path when under the socket length limit", () => {
    const wipDir = "/tmp/wip";
    const result = getSocketPath(wipDir, "my-plan");
    expect(result).toBe(join(wipDir, "my-plan", "runner.sock"));
  });

  test("returns co-located path for typical short slug", () => {
    const wipDir = "/tmp/wip";
    const result = getSocketPath(wipDir, "feat-add-auth-flow");
    expect(result).toBe(join(wipDir, "feat-add-auth-flow", "runner.sock"));
  });

  describe.skipIf(process.platform === "win32")(
    "Unix socket path length limit",
    () => {
      test("falls back to temp-dir path when path exceeds limit", () => {
        const wipDir =
          "/home/user/.ralphai/repos/github-com-some-org-some-long-repo-name/pipeline/in-progress";
        const slug =
          "gh-279-feat-menu-items-selectable-list-component-main-menu-screen";
        const result = getSocketPath(wipDir, slug);

        // Should NOT be the co-located path
        const colocated = join(wipDir, slug, "runner.sock");
        expect(result).not.toBe(colocated);

        // Should be under tmpdir with a deterministic hash
        expect(result).toMatch(
          new RegExp(`^${tmpdir()}/ralphai-[0-9a-f]{16}\\.sock$`),
        );

        // Must fit within the Unix socket path limit
        expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(103);
      });

      test("produces deterministic path for the same inputs", () => {
        const wipDir =
          "/home/user/.ralphai/repos/some-very-long-repo-slug-name/pipeline/in-progress";
        const slug = "gh-999-some-extremely-long-plan-slug-that-exceeds-limits";
        const a = getSocketPath(wipDir, slug);
        const b = getSocketPath(wipDir, slug);
        expect(a).toBe(b);
      });

      test("produces different paths for different inputs", () => {
        const wipDir =
          "/home/user/.ralphai/repos/some-very-long-repo-slug-name/pipeline/in-progress";
        const a = getSocketPath(
          wipDir,
          "gh-100-some-extremely-long-plan-slug-that-exceeds-limits-aaa",
        );
        const b = getSocketPath(
          wipDir,
          "gh-200-some-extremely-long-plan-slug-that-exceeds-limits-bbb",
        );
        expect(a).not.toBe(b);
      });
    },
  );
});

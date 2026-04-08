# Fix: IPC socket path truncation on Linux

## Problem

Unix domain sockets have a hard path length limit of 108 bytes (`sun_path` in `sockaddr_un` on Linux). When a plan slug is long (e.g., from a verbose GitHub issue title), the computed socket path exceeds this limit.

**Example:** For issue #279 "feat: menu items selectable list component main menu screen", the socket path becomes:

```
/home/mfaux/.ralphai/repos/github-work-mfaux-ralphai/pipeline/in-progress/gh-279-feat-menu-items-selectable-list-component-main-menu-screen/runner.sock
```

That's **151 bytes** -- well over the 108-byte limit.

### What happens

The Linux kernel **silently truncates** the path to 108 bytes, creating a socket file at:

```
pipeline/in-progress/gh-279-feat-menu-items-selectable-
```

This is a Unix socket file (`srwxrwxr-x`) sitting at the `in-progress/` directory level instead of `runner.sock` inside the slug subdirectory. It:

1. Is never cleaned up (the `close()` logic in `ipc-server.ts` tries to remove the full path, which doesn't match the truncated file)
2. Cannot be read as a regular file, confusing any tooling that lists the pipeline directory
3. Creates a stale socket that persists across runs

## Root cause

`getSocketPath()` in `src/ipc-protocol.ts:107-108` computes:

```typescript
export function getSocketPath(wipDir: string, slug: string): string {
  return join(wipDir, slug, "runner.sock");
}
```

No length validation is performed. The `createIpcServer()` in `src/ipc-server.ts` passes this path directly to `server.listen(socketPath)`, and Node's `net.Server` does not validate the length either -- it delegates to the kernel which truncates silently.

## Fix

### Approach: Use `/tmp` with a hash when the path is too long

Modify `getSocketPath()` in `src/ipc-protocol.ts` to detect when the natural path would exceed the Unix socket limit and fall back to a `/tmp`-based path using a deterministic hash.

**On Windows**, named pipes don't have this limit, so always use the natural path.

### Changes to `src/ipc-protocol.ts`

Add imports:

```typescript
import { tmpdir } from "os";
import { createHash } from "crypto";
```

Add constant:

```typescript
/**
 * Maximum safe socket path length.
 * Linux `sun_path` is 108 bytes including the null terminator.
 * macOS is 104 bytes. We use 104 as the safe cross-platform limit.
 */
const MAX_SOCKET_PATH = 104;
```

Replace `getSocketPath()`:

```typescript
/**
 * Compute the IPC socket path for a plan.
 *
 * Preferred layout: `<wipDir>/<slug>/runner.sock`
 * (co-located with `runner.pid` and other plan artifacts).
 *
 * When the preferred path exceeds the Unix domain socket path length limit
 * (104 bytes on macOS, 108 on Linux), falls back to a deterministic
 * temp-directory path:  `<tmpdir>/ralphai-<hash>.sock`
 *
 * On Windows, named pipes have no path length restriction, so the
 * preferred path is always used.
 */
export function getSocketPath(wipDir: string, slug: string): string {
  const preferred = join(wipDir, slug, "runner.sock");

  if (process.platform === "win32") return preferred;

  if (Buffer.byteLength(preferred, "utf8") <= MAX_SOCKET_PATH) {
    return preferred;
  }

  // Deterministic hash so both server and client resolve to the same path.
  const hash = createHash("sha256")
    .update(preferred)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `ralphai-${hash}.sock`);
}
```

### Changes to `src/ipc-server.ts`

No changes needed. The `createIpcServer()` function already:

- Removes stale socket files before listening (`rmSync(socketPath, { force: true })`)
- Removes the socket file on `close()` using the same path

Since `getSocketPath()` is deterministic, both creation and cleanup will use the same (possibly temp-dir) path.

### Changes to `src/ipc-protocol.test.ts`

Update `getSocketPath` tests:

```typescript
describe("getSocketPath", () => {
  test("returns co-located path when under the socket length limit", () => {
    const wipDir = "/tmp/wip";
    const result = getSocketPath(wipDir, "my-plan");
    expect(result).toBe(join(wipDir, "my-plan", "runner.sock"));
  });

  test("falls back to temp-dir path when path exceeds Unix socket limit", () => {
    const wipDir =
      "/home/user/.ralphai/repos/github-com-some-org-some-long-repo-name/pipeline/in-progress";
    const slug =
      "gh-279-feat-menu-items-selectable-list-component-main-menu-screen";
    const result = getSocketPath(wipDir, slug);

    if (process.platform === "win32") {
      // Windows uses named pipes — no length restriction
      expect(result).toBe(join(wipDir, slug, "runner.sock"));
    } else {
      // Falls back to hashed temp path
      expect(result).toMatch(/^.*ralphai-[0-9a-f]{16}\.sock$/);
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(104);
    }
  });

  test("produces deterministic temp-dir path for the same inputs", () => {
    if (process.platform === "win32") return; // N/A on Windows
    const wipDir =
      "/home/user/.ralphai/repos/some-very-long-repo-slug-name/pipeline/in-progress";
    const slug = "gh-999-some-extremely-long-plan-slug-that-exceeds-limits";
    const a = getSocketPath(wipDir, slug);
    const b = getSocketPath(wipDir, slug);
    expect(a).toBe(b);
  });
});
```

### Cleanup: Remove the stale socket

The existing stale socket at the user's pipeline path should be removed:

```bash
rm /home/mfaux/.ralphai/repos/github-work-mfaux-ralphai/pipeline/in-progress/gh-279-feat-menu-items-selectable-
```

## Notes

- The hash is deterministic so both server (runner) and any future client (CLI dashboard) resolve the same socket path for a given plan
- `Buffer.byteLength` is used instead of `string.length` because socket paths are byte-limited, not character-limited
- The 16-char hex prefix of SHA-256 gives 64 bits of entropy, sufficient to avoid collisions across concurrent plans
- Temp-dir sockets will be cleaned up by `ipc-server.ts` `close()` since it uses the same path. If the runner crashes, stale `/tmp` sockets are harmless (overwritten on next run via `rmSync` before `listen`)

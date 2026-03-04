import { execSync } from "child_process";
import { join } from "path";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function stripLogo(str: string): string {
  // ralphai has no fancy logo, but strip any leading blank lines
  return str.replace(/^\n+/, "");
}

export function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
  timeout?: number,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const output = execSync(
      `node --experimental-strip-types "${CLI_PATH}" ${args.join(" ")}`,
      {
        encoding: "utf-8",
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: env ? { ...process.env, ...env } : undefined,
        timeout: timeout ?? 30000,
      },
    );
    return { stdout: stripAnsi(output), stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: stripAnsi(error.stdout || ""),
      stderr: stripAnsi(error.stderr || ""),
      exitCode: error.status || 1,
    };
  }
}

export function runCliOutput(args: string[], cwd?: string): string {
  const result = runCli(args, cwd);
  return result.stdout || result.stderr;
}

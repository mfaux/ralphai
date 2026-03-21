/**
 * Frontmatter CLI — thin wrapper around src/frontmatter.ts for shell callers.
 *
 * Usage:
 *   node frontmatter-cli.mjs scope          <file>
 *   node frontmatter-cli.mjs depends-on     <file>
 *   node frontmatter-cli.mjs issue          <file>
 *
 * Output:
 *   scope:      prints the scope value (one line), or nothing if absent.
 *   depends-on: prints one dependency filename per line, or nothing.
 *   issue:      prints key=value lines for source, issue, issue-url.
 *               Missing fields produce an empty value (e.g. "source=").
 */

import {
  extractScope,
  extractDependsOn,
  extractIssueFrontmatter,
} from "./frontmatter.ts";

const [command, file] = process.argv.slice(2);

if (!command || !file) {
  process.stderr.write(
    "Usage: frontmatter-cli <scope|depends-on|issue> <file>\n",
  );
  process.exit(1);
}

switch (command) {
  case "scope":
    {
      const scope = extractScope(file);
      if (scope) process.stdout.write(scope + "\n");
    }
    break;

  case "depends-on":
    {
      const deps = extractDependsOn(file);
      for (const dep of deps) {
        process.stdout.write(dep + "\n");
      }
    }
    break;

  case "issue":
    {
      const fm = extractIssueFrontmatter(file);
      process.stdout.write(`source=${fm.source}\n`);
      process.stdout.write(`issue=${fm.issue ?? ""}\n`);
      process.stdout.write(`issue-url=${fm.issueUrl}\n`);
    }
    break;

  default:
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exit(1);
}

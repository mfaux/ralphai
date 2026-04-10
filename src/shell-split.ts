/**
 * Minimal shell-like argument splitting.
 * Handles single/double quotes and backslash escapes.
 */
export function shellSplit(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasQuote = false; // Track if current token started with a quote

  for (const ch of cmd) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasQuote = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasQuote = true;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current.length > 0 || hasQuote) {
        parts.push(current);
        current = "";
        hasQuote = false;
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || hasQuote) {
    parts.push(current);
  }
  return parts;
}

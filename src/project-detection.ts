import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

export interface DetectedPM {
  manager: PackageManager;
  /** Prefix for running scripts, e.g. "pnpm" or "bun run" */
  runPrefix: string;
}

export interface WorkspacePackage {
  name: string;
  path: string;
}

/**
 * Language-agnostic project detection result.
 * Carries enough information for callers to work without knowing
 * ecosystem-specific details.
 */
export interface DetectedProject {
  /** Ecosystem identifier, e.g. "node", "dotnet", "go" */
  ecosystem: string;
  /** Human-readable label, e.g. "pnpm 9.x", "dotnet (solution)" */
  label: string;
  /** Command prefix for running scripts, e.g. "pnpm", "dotnet" */
  runPrefix: string;
  /** Auto-detected feedback commands */
  feedbackCommands: string[];
  /** Package manager name (node ecosystem only) */
  manager?: PackageManager;
  /** Detected workspace packages (monorepos) */
  workspaces?: WorkspacePackage[];
  /** Other ecosystems detected alongside the primary one */
  additionalEcosystems?: DetectedProject[];
}

// ---------------------------------------------------------------------------
// Node.js / TypeScript detection
// ---------------------------------------------------------------------------

/**
 * Detect the project's package manager by checking for lock files and config
 * files in priority order. Returns null for non-JS/TS projects.
 */
export function detectPackageManager(cwd: string): DetectedPM | null {
  const has = (file: string) => existsSync(join(cwd, file));

  // Deno — checked first since deno.json is unambiguous
  if (has("deno.json") || has("deno.jsonc")) {
    return { manager: "deno", runPrefix: "deno task" };
  }

  // Lock-file based detection (most reliable)
  if (has("bun.lockb") || has("bun.lock")) {
    return { manager: "bun", runPrefix: "bun run" };
  }
  if (has("pnpm-lock.yaml") || has("pnpm-workspace.yaml")) {
    return { manager: "pnpm", runPrefix: "pnpm" };
  }
  if (has("yarn.lock")) {
    return { manager: "yarn", runPrefix: "yarn" };
  }
  if (has("package-lock.json")) {
    return { manager: "npm", runPrefix: "npm run" };
  }

  // Fallback: check packageManager field in package.json
  const pkgPath = join(cwd, "package.json");
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (typeof pkg.packageManager === "string") {
        const name = pkg.packageManager.split("@")[0] as string;
        if (name === "pnpm") return { manager: "pnpm", runPrefix: "pnpm" };
        if (name === "yarn") return { manager: "yarn", runPrefix: "yarn" };
        if (name === "bun") return { manager: "bun", runPrefix: "bun run" };
        if (name === "npm") return { manager: "npm", runPrefix: "npm run" };
      }
      // package.json exists but no packageManager field — default to npm
      return { manager: "npm", runPrefix: "npm run" };
    } catch {
      return { manager: "npm", runPrefix: "npm run" };
    }
  }

  // No JS/TS project signals found
  return null;
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

/**
 * Parse pnpm-workspace.yaml to extract the `packages` globs.
 * Uses a simple line-based parser to avoid a YAML dependency.
 */
function parsePnpmWorkspaceGlobs(content: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (line.startsWith("- ")) {
        const value = line
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (value) globs.push(value);
      } else if (line !== "" && !line.startsWith("#")) {
        // End of packages list (new top-level key)
        break;
      }
    }
  }
  return globs;
}

/**
 * Expand simple workspace globs (e.g. "packages/*") into directories
 * that contain a package.json. Only supports trailing /* patterns and
 * bare directory names. Does not handle ** or other complex globs.
 */
function expandWorkspaceGlobs(
  cwd: string,
  globs: string[],
): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>();

  for (const glob of globs) {
    // Strip negation globs (e.g. "!packages/internal")
    if (glob.startsWith("!")) continue;

    // Handle "dir/*" pattern — list immediate children of dir
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      const parentDir = join(cwd, parent);
      if (!existsSync(parentDir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(parentDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const pkgDir = join(parentDir, entry);
        const pkgJsonPath = join(pkgDir, "package.json");
        if (!existsSync(pkgJsonPath)) continue;
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          const name = typeof pkg.name === "string" ? pkg.name : entry;
          const rel = `${parent}/${entry}`;
          if (!seen.has(rel)) {
            seen.add(rel);
            packages.push({ name, path: rel });
          }
        } catch {
          // Skip packages with invalid package.json
        }
      }
    } else {
      // Bare directory — treat as a single workspace
      const pkgJsonPath = join(cwd, glob, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        const name = typeof pkg.name === "string" ? pkg.name : glob;
        if (!seen.has(glob)) {
          seen.add(glob);
          packages.push({ name, path: glob });
        }
      } catch {
        // Skip
      }
    }
  }

  return packages;
}

/**
 * Detect monorepo workspace packages.
 *
 * Detection sources (checked in order):
 * 1. `pnpm-workspace.yaml` — read `packages` globs
 * 2. `package.json` `workspaces` field (yarn/npm/bun)
 * 3. `.sln` file — parse Project entries to discover .csproj sub-projects
 *
 * Returns an array of { name, path } for each discovered package.
 */
export function detectWorkspaces(cwd: string): WorkspacePackage[] {
  let nodeWorkspaces: WorkspacePackage[] = [];

  // 1. pnpm-workspace.yaml
  const pnpmWsPath = join(cwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWsPath)) {
    try {
      const content = readFileSync(pnpmWsPath, "utf-8");
      const globs = parsePnpmWorkspaceGlobs(content);
      if (globs.length > 0) {
        nodeWorkspaces = expandWorkspaceGlobs(cwd, globs);
      }
    } catch {
      // Fall through
    }
  }

  // 2. package.json workspaces field (only if pnpm didn't find anything)
  if (nodeWorkspaces.length === 0) {
    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const workspaces = pkg.workspaces;
        if (Array.isArray(workspaces)) {
          nodeWorkspaces = expandWorkspaceGlobs(cwd, workspaces);
        } else if (workspaces && Array.isArray(workspaces.packages)) {
          // Yarn also supports { packages: [...] } object form
          nodeWorkspaces = expandWorkspaceGlobs(cwd, workspaces.packages);
        }
      } catch {
        // Fall through
      }
    }
  }

  // 3. .sln file — parse Project entries to discover .csproj sub-projects.
  //    Merged with Node workspaces when both exist (mixed repos).
  let dotnetWorkspaces: WorkspacePackage[] = [];
  const slnFiles = findSlnFiles(cwd);
  if (slnFiles.length > 0) {
    try {
      const content = readFileSync(join(cwd, slnFiles[0]!), "utf-8");
      const projects = parseSolutionProjects(content);
      if (projects.length > 0) {
        dotnetWorkspaces = projects;
      }
    } catch {
      // Fall through
    }
  }

  // Merge and deduplicate by path (Node workspaces listed first)
  if (nodeWorkspaces.length === 0) return dotnetWorkspaces;
  if (dotnetWorkspaces.length === 0) return nodeWorkspaces;

  const seen = new Set(nodeWorkspaces.map((ws) => ws.path));
  const merged = [...nodeWorkspaces];
  for (const ws of dotnetWorkspaces) {
    if (!seen.has(ws.path)) {
      seen.add(ws.path);
      merged.push(ws);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Feedback command detection
// ---------------------------------------------------------------------------

/** Well-known script names to look for, in display order. */
const SCRIPT_CANDIDATES = [
  "build",
  "test",
  "type-check",
  "typecheck",
  "lint",
  "format:check",
];

/**
 * Detect feedback commands by inspecting the project's package.json scripts
 * (or deno.json tasks) and mapping them through the detected package manager.
 * Returns a comma-separated string suitable for the feedbackCommands config key,
 * or an empty string if nothing useful is detected.
 */
export function detectFeedbackCommands(cwd: string): string {
  const pm = detectPackageManager(cwd);
  if (!pm) return "";

  const commands: string[] = [];

  if (pm.manager === "deno") {
    // Read tasks from deno.json / deno.jsonc
    for (const name of ["deno.json", "deno.jsonc"]) {
      const denoPath = join(cwd, name);
      if (!existsSync(denoPath)) continue;
      try {
        const deno = JSON.parse(readFileSync(denoPath, "utf-8"));
        const tasks = deno.tasks;
        if (tasks && typeof tasks === "object") {
          for (const script of SCRIPT_CANDIDATES) {
            if (script in tasks) {
              commands.push(`deno task ${script}`);
            }
          }
        }
      } catch {
        // ignore parse errors
      }
      break; // only read the first one found
    }
    // deno has a built-in test runner even without a task
    if (
      !commands.some((c) => c.includes("test")) &&
      existsSync(join(cwd, "deno.json"))
    ) {
      commands.push("deno test");
    }
  } else {
    // npm/pnpm/yarn/bun — read scripts from package.json
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return "";
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") {
        // For test, npm/pnpm/yarn/bun all support the short form (e.g. "pnpm test")
        const testShorthand = ["npm", "pnpm", "yarn", "bun"];
        for (const script of SCRIPT_CANDIDATES) {
          if (!(script in scripts)) continue;
          if (script === "test" && testShorthand.includes(pm.manager)) {
            commands.push(`${pm.manager} test`);
          } else {
            commands.push(`${pm.runPrefix} ${script}`);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return commands.join(",");
}

/**
 * Derive scoped feedback commands for a workspace package.
 * Maps root-level feedback commands to their filtered equivalents
 * using the detected package manager.
 */
export function deriveScopedFeedback(
  pm: DetectedPM,
  rootCommands: string[],
  packageName: string,
): string[] {
  return rootCommands.map((cmd) => {
    const parts = cmd.trim().split(/\s+/);
    const runner = parts[0];
    // Only rewrite commands that match the detected package manager
    if (runner !== pm.manager) return cmd;

    switch (pm.manager) {
      case "pnpm": {
        // "pnpm build" → "pnpm --filter <name> build"
        // "pnpm run test" → "pnpm --filter <name> run test"
        const rest = parts.slice(1);
        // Remove "run" prefix if present — pnpm --filter <name> test works
        const filtered = rest.filter((p) => p !== "run");
        return `pnpm --filter ${packageName} ${filtered.join(" ")}`;
      }
      case "yarn": {
        // "yarn build" → "yarn workspace <name> build"
        const rest = parts.slice(1);
        return `yarn workspace ${packageName} ${rest.join(" ")}`;
      }
      case "npm": {
        // "npm run build" → "npm -w <name> run build"
        const rest = parts.slice(1);
        return `npm -w ${packageName} ${rest.join(" ")}`;
      }
      case "bun": {
        // "bun run build" → "bun --filter <name> run build"
        const rest = parts.slice(1);
        return `bun --filter ${packageName} ${rest.join(" ")}`;
      }
      default:
        return cmd;
    }
  });
}

/**
 * Derive scoped feedback commands for a dotnet sub-project.
 * Rewrites `dotnet build` → `dotnet build <projectPath>` and
 * `dotnet test` → `dotnet test <projectPath>`.
 */
export function deriveDotnetScopedFeedback(
  rootCommands: string[],
  projectPath: string,
): string[] {
  return rootCommands.map((cmd) => {
    const trimmed = cmd.trim();
    // Only rewrite dotnet commands
    if (!trimmed.startsWith("dotnet ")) return cmd;

    // "dotnet build" → "dotnet build <path>", "dotnet test" → "dotnet test <path>"
    return `${trimmed} ${projectPath}`;
  });
}

// ---------------------------------------------------------------------------
// Node project detection (wraps PM + feedback into DetectedProject)
// ---------------------------------------------------------------------------

/**
 * Detect a Node.js/TypeScript/Deno project.
 * Returns a DetectedProject if any JS ecosystem signals are found, null otherwise.
 */
export function detectNodeProject(cwd: string): DetectedProject | null {
  const pm = detectPackageManager(cwd);
  if (!pm) return null;

  const feedbackStr = detectFeedbackCommands(cwd);
  const feedbackCommands = feedbackStr
    ? feedbackStr.split(",").map((c) => c.trim())
    : [];

  return {
    ecosystem: "node",
    label: pm.manager,
    runPrefix: pm.runPrefix,
    feedbackCommands,
    manager: pm.manager,
  };
}

// ---------------------------------------------------------------------------
// C# / .NET detection
// ---------------------------------------------------------------------------

/**
 * Parse a .sln file to extract project entries.
 * Returns an array of { name, path } where path is the directory containing
 * the .csproj file, relative to the solution root (using forward slashes).
 *
 * .sln Project lines look like:
 *   Project("{FAE04EC0-...}") = "MyProject", "src\MyProject\MyProject.csproj", "{GUID}"
 */
export function parseSolutionProjects(content: string): WorkspacePackage[] {
  const projects: WorkspacePackage[] = [];
  const seen = new Set<string>();

  // Match: Project("...") = "Name", "relative\path\to\File.csproj", "..."
  const projectLineRe =
    /^Project\("[^"]*"\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,/gm;

  let match;
  while ((match = projectLineRe.exec(content)) !== null) {
    const name = match[1] as string;
    const rawPath = match[2] as string;

    // Only include .csproj entries (skip solution folders and other types)
    if (!rawPath.endsWith(".csproj")) continue;

    // Convert backslashes to forward slashes and get the directory
    const normalizedPath = rawPath.replace(/\\/g, "/");
    const projectDir = normalizedPath.includes("/")
      ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
      : ".";

    if (!seen.has(projectDir)) {
      seen.add(projectDir);
      projects.push({ name, path: projectDir });
    }
  }

  return projects;
}

/**
 * Find .sln files in the given directory.
 * Returns the filenames (not full paths) of any .sln files found.
 */
function findSlnFiles(cwd: string): string[] {
  try {
    return readdirSync(cwd).filter((f) => f.endsWith(".sln"));
  } catch {
    return [];
  }
}

/**
 * Detect a C# / .NET project by looking for .sln or .csproj files.
 * Prefers solution files over individual project files.
 * When a .sln is found, parses it to discover sub-projects as workspaces.
 */
export function detectDotnetProject(cwd: string): DetectedProject | null {
  const slnFiles = findSlnFiles(cwd);

  if (slnFiles.length > 0) {
    // Parse the first .sln to discover sub-projects
    let workspaces: WorkspacePackage[] | undefined;
    try {
      const slnContent = readFileSync(join(cwd, slnFiles[0]!), "utf-8");
      const projects = parseSolutionProjects(slnContent);
      if (projects.length > 0) {
        workspaces = projects;
      }
    } catch {
      // Fall back to no workspace discovery
    }

    return {
      ecosystem: "dotnet",
      label: "dotnet (solution)",
      runPrefix: "dotnet",
      feedbackCommands: ["dotnet build", "dotnet test"],
      workspaces,
    };
  }

  const hasCsproj = (() => {
    try {
      return readdirSync(cwd).some((f) => f.endsWith(".csproj"));
    } catch {
      return false;
    }
  })();

  if (hasCsproj) {
    return {
      ecosystem: "dotnet",
      label: "dotnet (project)",
      runPrefix: "dotnet",
      feedbackCommands: ["dotnet build", "dotnet test"],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Go detection
// ---------------------------------------------------------------------------

/**
 * Detect a Go project by looking for go.mod.
 */
export function detectGoProject(cwd: string): DetectedProject | null {
  if (existsSync(join(cwd, "go.mod"))) {
    return {
      ecosystem: "go",
      label: "go module",
      runPrefix: "go",
      feedbackCommands: ["go build ./...", "go test ./..."],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rust detection
// ---------------------------------------------------------------------------

/**
 * Detect a Rust project by looking for Cargo.toml.
 */
export function detectRustProject(cwd: string): DetectedProject | null {
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return {
      ecosystem: "rust",
      label: "cargo",
      runPrefix: "cargo",
      feedbackCommands: ["cargo build", "cargo test"],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Python detection
// ---------------------------------------------------------------------------

/**
 * Detect a Python project by looking for pyproject.toml, setup.py,
 * or requirements.txt. Suggests pytest if detected in pyproject.toml.
 */
export function detectPythonProject(cwd: string): DetectedProject | null {
  const pyprojectPath = join(cwd, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    const feedbackCommands: string[] = [];
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      if (/\[tool\.pytest\b/.test(content) || /pytest/.test(content)) {
        feedbackCommands.push("python -m pytest");
      }
    } catch {
      // ignore read errors
    }
    return {
      ecosystem: "python",
      label: "python (pyproject)",
      runPrefix: "python",
      feedbackCommands,
    };
  }

  if (existsSync(join(cwd, "setup.py"))) {
    return {
      ecosystem: "python",
      label: "python (setup.py)",
      runPrefix: "python",
      feedbackCommands: [],
    };
  }

  if (existsSync(join(cwd, "requirements.txt"))) {
    return {
      ecosystem: "python",
      label: "python (requirements.txt)",
      runPrefix: "python",
      feedbackCommands: [],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Java / Kotlin detection
// ---------------------------------------------------------------------------

/**
 * Detect a Java/Kotlin project by looking for pom.xml (Maven)
 * or build.gradle / build.gradle.kts (Gradle).
 */
export function detectJavaProject(cwd: string): DetectedProject | null {
  if (existsSync(join(cwd, "pom.xml"))) {
    return {
      ecosystem: "java",
      label: "maven",
      runPrefix: "mvn",
      feedbackCommands: ["mvn test"],
    };
  }

  if (
    existsSync(join(cwd, "build.gradle")) ||
    existsSync(join(cwd, "build.gradle.kts"))
  ) {
    return {
      ecosystem: "java",
      label: "gradle",
      runPrefix: "gradle",
      feedbackCommands: ["gradle test"],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Top-level project detection
// ---------------------------------------------------------------------------

/**
 * Detect the project type by trying each ecosystem detector in priority order.
 * Returns the first match, or null if no ecosystem is detected.
 *
 * Priority order: node > dotnet > go > rust > java > python.
 * Node always wins if present. When multiple ecosystems are detected,
 * secondary ecosystems are listed in `additionalEcosystems` and their
 * feedback commands are merged into the primary result.
 */
export function detectProject(cwd: string): DetectedProject | null {
  const detectors = [
    detectNodeProject,
    detectDotnetProject,
    detectGoProject,
    detectRustProject,
    detectJavaProject,
    detectPythonProject,
  ];

  let primary: DetectedProject | null = null;
  const additional: DetectedProject[] = [];

  for (const detect of detectors) {
    const result = detect(cwd);
    if (!result) continue;
    if (!primary) {
      primary = result;
    } else {
      additional.push(result);
    }
  }

  if (!primary) return null;

  if (additional.length > 0) {
    primary.additionalEcosystems = additional;
    // Merge feedback commands from additional ecosystems
    for (const eco of additional) {
      primary.feedbackCommands.push(...eco.feedbackCommands);
    }
  }

  return primary;
}

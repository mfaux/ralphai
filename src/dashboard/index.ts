/**
 * Dashboard launcher — renders the Ink app to the terminal.
 *
 * Render options:
 * - patchConsole: false — the dashboard doesn't use console.log and spawns
 *   detached child processes; patching adds unnecessary overhead.
 * - waitUntilExit() — ensures the process exits cleanly after the Ink app
 *   unmounts (via `q` or Ctrl+C).
 */

import React from "react";
import { render } from "ink";
import { App } from "./App.tsx";
import { SpinnerContext, useSpinnerProvider } from "./hooks.ts";

/**
 * Root wrapper that provides the shared spinner context.
 * Runs a single setInterval for all spinner consumers in the tree.
 */
function Root() {
  const frame = useSpinnerProvider();
  return React.createElement(
    SpinnerContext.Provider,
    { value: frame },
    React.createElement(App),
  );
}

export function launchDashboard(): void {
  const instance = render(React.createElement(Root), {
    patchConsole: false,
  });

  instance.waitUntilExit().then(() => {
    process.exit(0);
  });
}

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

export function launchDashboard(): void {
  const instance = render(React.createElement(App), {
    patchConsole: false,
  });

  instance.waitUntilExit().then(() => {
    process.exit(0);
  });
}

/**
 * Dashboard launcher — renders the Ink app to the terminal.
 */

import React from "react";
import { render } from "ink";
import { App } from "./App.tsx";

export function launchDashboard(): void {
  render(React.createElement(App));
}

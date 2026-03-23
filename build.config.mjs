import { defineBuildConfig } from "obuild/config";

// Stub out react-devtools-core so Ink's optional devtools import
// doesn't leave an unresolved bare specifier in the bundle.
const stubDevtools = {
  name: "stub-react-devtools-core",
  resolveId(id) {
    if (id === "react-devtools-core") return "\0react-devtools-core-stub";
  },
  load(id) {
    if (id === "\0react-devtools-core-stub")
      return "export default { initialize() {}, connectToDevTools() {} };";
  },
};

// https://github.com/unjs/obuild
export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: "./src/cli.ts",
      rolldown: { plugins: [stubDevtools] },
    },
    { type: "bundle", input: "./src/config-cli.ts" },
    { type: "bundle", input: "./src/frontmatter-cli.ts" },
    { type: "bundle", input: "./src/plan-detection-cli.ts" },
    { type: "bundle", input: "./src/receipt-cli.ts" },
    { type: "bundle", input: "./src/scope-cli.ts" },
  ],
});

import { defineBuildConfig } from "obuild/config";

// https://github.com/unjs/obuild
export default defineBuildConfig({
  entries: [
    { type: "bundle", input: "./src/cli.ts" },
    { type: "bundle", input: "./src/config-cli.ts" },
    { type: "bundle", input: "./src/frontmatter-cli.ts" },
    { type: "bundle", input: "./src/plan-detection-cli.ts" },
    { type: "bundle", input: "./src/receipt-cli.ts" },
    { type: "bundle", input: "./src/scope-cli.ts" },
  ],
});

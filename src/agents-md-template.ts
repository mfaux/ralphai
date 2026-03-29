export const AGENTS_MD_HEADER = `# Agent Instructions

Project-specific guidance for AI coding agents working in this codebase.

`;

export const AGENTS_MD_RALPHAI_SECTION = `## Ralphai

This project uses [Ralphai](https://github.com/mfaux/ralphai) for autonomous execution.
Plan files go in the global pipeline backlog (run \`ralphai backlog-dir\` to find it).
Install the planning skill for plan writing guidance: \`npx skills add mfaux/ralphai -g\`.
`;

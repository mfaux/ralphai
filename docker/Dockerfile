# Parameterized sandbox image for Ralphai agent execution.
#
# Design: Non-root container execution
#
# The container is designed to run as the host user (via `--user UID:GID`
# at runtime) so that files created inside the container are owned by the
# host user, not root. This prevents permission issues during worktree
# cleanup.
#
# To support this:
# - All tools (Bun, agent CLIs) are installed to global paths (/usr/local/bin)
#   so they are accessible to any UID, not just root.
# - A world-writable /home/agent directory is created as the container HOME.
#   The runtime sets HOME=/home/agent via -e flag.
# - No USER directive — the --user flag handles this at runtime.
#
# Usage:
#   docker build --build-arg AGENT=claude -t ghcr.io/mfaux/ralphai-sandbox:claude docker/
#   docker build --build-arg AGENT=opencode -t ghcr.io/mfaux/ralphai-sandbox:opencode docker/
#   docker build --build-arg AGENT=codex -t ghcr.io/mfaux/ralphai-sandbox:codex docker/
#
# The AGENT arg controls which CLI is installed. All images share a common
# base with git, Node.js, and Bun pre-installed.

FROM debian:bookworm-slim AS base

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies: git, curl, and CA certificates (for HTTPS)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS via NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm and yarn support
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Bun to a global path (not /root/.bun)
# Explicit chmod ensures the binary is world-executable for non-root
# container users (the --user flag sets an arbitrary UID at runtime).
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash && \
    chmod 755 /usr/local/bin/bun

# ---------------------------------------------------------------------------
# Agent CLI installation (conditional on AGENT build arg)
# ---------------------------------------------------------------------------

ARG AGENT=opencode

# Claude Code: install via npm
RUN if [ "$AGENT" = "claude" ]; then \
      npm install -g @anthropic-ai/claude-code; \
    fi

# OpenCode: download the release binary directly.
# The install script relies on the GitHub API to resolve the latest version,
# which is rate-limited for unauthenticated requests and fails inside Docker
# Buildx containers. Downloading via the /releases/latest redirect avoids
# the API call entirely.
RUN if [ "$AGENT" = "opencode" ]; then \
      curl -fsSL -o /tmp/opencode.tar.gz \
        "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz" && \
      tar -xzf /tmp/opencode.tar.gz -C /tmp && \
      mv /tmp/opencode /usr/local/bin/opencode && \
      chmod 755 /usr/local/bin/opencode && \
      rm -f /tmp/opencode.tar.gz; \
    fi

# Codex: install via npm
RUN if [ "$AGENT" = "codex" ]; then \
      npm install -g @openai/codex; \
    fi

# Configure git defaults for container use
RUN git config --system --add safe.directory '*'

# Create the container home directory and common subdirectories with open
# permissions so any UID can use them as HOME (the --user flag sets the UID
# at runtime). Pre-creating these prevents EACCES errors when tools (Node,
# Bun, etc.) try to mkdir $HOME/.cache or other XDG paths — Docker's bind
# mount setup can create intermediate directories as root before the
# container process starts, which would shadow the 1777 parent.
RUN mkdir -p /home/agent/.cache \
             /home/agent/.config/github-copilot \
             /home/agent/.local/share/opencode \
             /home/agent/.local/bin && \
    chmod -R 1777 /home/agent

WORKDIR /workspace

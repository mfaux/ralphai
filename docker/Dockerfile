# Parameterized sandbox image for Ralphai agent execution.
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

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# ---------------------------------------------------------------------------
# Agent CLI installation (conditional on AGENT build arg)
# ---------------------------------------------------------------------------

ARG AGENT=opencode

# Claude Code: install via npm
RUN if [ "$AGENT" = "claude" ]; then \
      npm install -g @anthropic-ai/claude-code; \
    fi

# OpenCode: install via official install script
RUN if [ "$AGENT" = "opencode" ]; then \
      curl -fsSL https://opencode.ai/install | bash; \
    fi

# Codex: install via npm
RUN if [ "$AGENT" = "codex" ]; then \
      npm install -g @openai/codex; \
    fi

# Configure git defaults for container use
RUN git config --system --add safe.directory '*'

# Ensure agent install paths are on PATH (install scripts only update .bashrc,
# which isn't sourced in non-interactive shells)
ENV PATH="/root/.opencode/bin:${PATH}"

WORKDIR /workspace

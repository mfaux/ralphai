# ---------------------------------------------------------------------------
# Issue integration helpers
# ---------------------------------------------------------------------------

check_gh_available() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  return 0
}

detect_repo_from_url() {
  local url="$1"
  echo "$url" | sed -E 's#https://github\.com/([^/]+/[^/]+)/issues/.*#\1#'
}

# Prints owner/repo from ISSUE_REPO or auto-detects from git remote origin.
detect_issue_repo() {
  if [[ -n "$ISSUE_REPO" ]]; then
    echo "$ISSUE_REPO"
    return
  fi
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 1
  # Handle SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
  echo "$url" | sed -E 's#(git@|https://)github\.com[:/]##; s/\.git$//'
}

# Converts a string to a filename-safe lowercase slug (max 60 chars).
slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | head -c 60
}

# Pulls the oldest open GitHub issue with the configured label, converts it
# to a plan file, and drops it in the backlog directory.  Returns 0 on
# success (plan file created), 1 otherwise.
pull_github_issues() {
  [[ "$ISSUE_SOURCE" == "github" ]] || return 1

  check_gh_available || {
    log "gh CLI not available or not authenticated — skipping issue pull"
    return 1
  }

  local repo
  repo=$(detect_issue_repo) || {
    log "Could not detect GitHub repo — skipping issue pull"
    return 1
  }

  # Get the oldest open issue with the configured label.
  # gh issue list returns newest first; use --jq 'last' to pick the oldest.
  local number
  number=$(gh issue list \
    --repo "$repo" \
    --label "$ISSUE_LABEL" \
    --state open \
    --limit 100 \
    --json number \
    --jq 'if length == 0 then empty else last.number end' 2>/dev/null) || return 1

  [[ -n "$number" ]] || return 1

  # Fetch full issue details using gh issue view
  local title body url slug filename
  title=$(gh issue view "$number" --repo "$repo" --json title --jq '.title' 2>/dev/null) || return 1
  body=$(gh issue view "$number" --repo "$repo" --json body --jq '.body' 2>/dev/null) || return 1
  url=$(gh issue view "$number" --repo "$repo" --json url --jq '.url' 2>/dev/null) || return 1

  slug=$(slugify "$title")
  filename="gh-${number}-${slug}.md"

  # Write plan file with frontmatter
  cat > "$BACKLOG_DIR/$filename" <<PLAN_EOF
---
source: github
issue: ${number}
issue-url: ${url}
---

# ${title}

${body}
PLAN_EOF

  # Update issue labels: add in-progress, remove intake label
  gh issue edit "$number" \
    --repo "$repo" \
    --add-label "$ISSUE_IN_PROGRESS_LABEL" \
    --remove-label "$ISSUE_LABEL" >/dev/null 2>&1

  if [[ "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
    gh issue comment "$number" \
      --repo "$repo" \
      --body "Ralphai picked up this issue and created a plan file. Working on it now." >/dev/null 2>&1
  fi

  log "Pulled GitHub issue #${number}: ${title} → ${filename}"
  return 0
}

# Reads issue-related frontmatter from a plan file.
# Sets global variables: PLAN_ISSUE_SOURCE, PLAN_ISSUE_NUMBER, PLAN_ISSUE_URL
read_issue_frontmatter() {
  local plan_file="$1"
  PLAN_ISSUE_SOURCE=""
  PLAN_ISSUE_NUMBER=""
  PLAN_ISSUE_URL=""
  [[ -f "$plan_file" ]] || return
  if head -1 "$plan_file" | grep -q '^---$'; then
    PLAN_ISSUE_SOURCE=$(sed -n '/^---$/,/^---$/{ /^source:/{ s/^source:[[:space:]]*//; p; } }' "$plan_file")
    PLAN_ISSUE_NUMBER=$(sed -n '/^---$/,/^---$/{ /^issue:/{ s/^issue:[[:space:]]*//; p; } }' "$plan_file")
    PLAN_ISSUE_URL=$(sed -n '/^---$/,/^---$/{ /^issue-url:/{ s/^issue-url:[[:space:]]*//; p; } }' "$plan_file")
  fi
}

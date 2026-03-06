# pr.sh — PR lifecycle: archive, create, group PR management
# Sourced by ralphai.sh — do not execute directly.

# --- Archive function: move PRD + progress from in-progress/ to out/ ---
# Only called on actual completion (COMPLETE signal).
archive_run() {
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$ARCHIVE_DIR"

  # Read issue frontmatter before files are moved (needed for post-completion hooks)
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      read_issue_frontmatter "$f"
      # Stop at the first file with github source frontmatter
      [[ "$PLAN_ISSUE_SOURCE" == "github" ]] && break
    fi
  done

  # Move progress file
  if [[ -f "$PROGRESS_FILE" ]]; then
    mv "$PROGRESS_FILE" "$ARCHIVE_DIR/progress-${timestamp}.md"
    echo "Archived $PROGRESS_FILE -> $ARCHIVE_DIR/progress-${timestamp}.md"
  fi

  # Move PRD/plan files from in-progress/ to out/
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      local basename
      basename=$(basename "$f")
      local dest="$ARCHIVE_DIR/${basename%.md}-${timestamp}.md"
      mv "$f" "$dest"
      echo "Archived $f -> $dest"
    fi
  done

  # Post progress comment on linked GitHub issue
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" && "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
    local repo
    repo=$(detect_issue_repo) && \
    gh issue comment "$PLAN_ISSUE_NUMBER" \
      --repo "$repo" \
      --body "Ralphai completed this task. Archiving plan and preparing to merge." >/dev/null 2>&1
  fi

  # Plan files are gitignored (local-only state), so no git operations needed.
  # The mv commands above are the entire archive step.

  # Post completion comment on linked issue
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" ]]; then
    if check_gh_available; then
      local repo=""
      if [[ -n "$PLAN_ISSUE_URL" ]]; then
        repo=$(detect_repo_from_url "$PLAN_ISSUE_URL")
      else
        repo=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@|https://)github\.com[:/]##; s/\.git$//')
      fi
      if [[ -n "$repo" ]]; then
        gh issue comment "$PLAN_ISSUE_NUMBER" \
          --repo "$repo" \
          --body "Ralphai completed this task and is preparing to merge." >/dev/null 2>&1 || true
      fi
    fi
  fi
}

# --- Create PR after completion (PR mode only) ---
create_pr() {
  local branch="$1"
  local plan_desc="$2"

  echo ""
  echo "Creating PR for '$branch'..."

  # Push branch to remote
  echo "Pushing $branch to origin..."
  if ! git push -u origin "$branch" 2>&1; then
    echo "WARNING: Failed to push branch. Branch left intact for manual push/PR."
    return 0
  fi

  # Build PR body from plan content and commit log
  local pr_body=""
  local plan_content=""
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      plan_content=$(cat "$f")
      break
    fi
  done
  # If plan was already archived, check out/ for the timestamped copy
  if [[ -z "$plan_content" ]]; then
    local latest_archived
    latest_archived=$(ls -t "$ARCHIVE_DIR"/*.md 2>/dev/null | head -1)
    if [[ -n "$latest_archived" ]]; then
      plan_content=$(cat "$latest_archived")
    fi
  fi

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$branch" --oneline --no-decorate 2>/dev/null || true)

  pr_body="## Plan

${plan_content:-_No plan content available._}

## Commits

\`\`\`
${commit_log:-_No commits._}
\`\`\`"

  echo "Creating PR: $branch -> $BASE_BRANCH"
  local pr_url
  pr_url=$(gh pr create \
    --base "$BASE_BRANCH" \
    --head "$branch" \
    --title "$plan_desc" \
    --body "$pr_body" 2>&1) || {
    echo "WARNING: Failed to create PR: $pr_url"
    echo "Branch '$branch' pushed to origin. Create PR manually."
    return 0
  }

  echo ""
  echo "PR created: $pr_url"

  # Comment on linked issue about the PR (but don't close — PR still needs review)
  if [[ "$PLAN_ISSUE_SOURCE" == "github" && -n "$PLAN_ISSUE_NUMBER" && "$ISSUE_COMMENT_PROGRESS" == "true" ]]; then
    local repo
    repo=$(detect_issue_repo) && \
    gh issue comment "$PLAN_ISSUE_NUMBER" \
      --repo "$repo" \
      --body "Ralphai created a PR for this issue: ${pr_url}" >/dev/null 2>&1
  fi
}

# List remaining group plans from backlog (for PR body formatting).
# Outputs markdown list items, one per line.
list_remaining_group_plans() {
  [[ -n "${GROUP_NAME:-}" ]] || return 0
  local candidates
  mapfile -t candidates < <(collect_group_plans "$GROUP_NAME")
  local f
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] || continue
    echo "- $(basename "$f")"
  done
}

# Create a draft PR for a group after the first plan completes.
# Sets GROUP_PR_URL and updates .group-state.
create_group_pr() {
  local branch="$1"
  local group_name="$2"

  echo ""
  echo "Creating draft PR for group '$group_name'..."

  # Push branch
  echo "Pushing $branch to origin..."
  if ! git push -u origin "$branch" 2>&1; then
    echo "WARNING: Failed to push branch. Branch left intact for manual push/PR."
    return 0
  fi

  local pr_title="feat: $group_name"
  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$branch" --oneline --no-decorate 2>/dev/null || true)

  local remaining
  remaining=$(list_remaining_group_plans)

  local pr_body="## Group: $group_name

**Status:** In progress ($GROUP_PLANS_COMPLETED/$GROUP_PLANS_TOTAL plans completed)

### Completed Plans
- $GROUP_CURRENT_PLAN ✅

### Remaining Plans
${remaining:-_None — group complete!_}

## Commits

\`\`\`
${commit_log:-_No commits yet._}
\`\`\`"

  local pr_url
  pr_url=$(gh pr create \
    --draft \
    --base "$BASE_BRANCH" \
    --head "$branch" \
    --title "$pr_title" \
    --body "$pr_body" 2>&1) || {
    echo "WARNING: Failed to create draft PR: $pr_url"
    echo "Branch '$branch' pushed to origin. Create PR manually."
    return 0
  }

  echo "Draft PR created: $pr_url"
  GROUP_PR_URL="$pr_url"

  # Persist PR URL in group state
  write_group_state \
    "group=$GROUP_NAME" \
    "branch=$GROUP_BRANCH" \
    "plans_total=$GROUP_PLANS_TOTAL" \
    "plans_completed=$GROUP_PLANS_COMPLETED" \
    "current_plan=$GROUP_CURRENT_PLAN" \
    "pr_url=$GROUP_PR_URL"
}

# Update the body of an existing group draft PR with current progress.
update_group_pr() {
  local branch="$1"
  local completed_plan="$2"

  [[ -n "${GROUP_PR_URL:-}" ]] || return 0

  echo "Updating group PR with progress..."

  # Push latest commits
  if ! git push origin "$branch" 2>&1; then
    echo "WARNING: Failed to push. PR body not updated."
    return 0
  fi

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$branch" --oneline --no-decorate 2>/dev/null || true)

  # Build completed plans list from archive
  local completed_list=""
  local f
  for f in "$ARCHIVE_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    local fb
    fb=$(basename "$f")
    # Skip progress files and non-plan files
    [[ "$fb" == progress-* ]] && continue
    completed_list="${completed_list}- ${fb} ✅
"
  done

  local remaining
  remaining=$(list_remaining_group_plans)

  local pr_body="## Group: $GROUP_NAME

**Status:** In progress ($GROUP_PLANS_COMPLETED/$GROUP_PLANS_TOTAL plans completed)

### Completed Plans
${completed_list:-_None yet._}

### Remaining Plans
${remaining:-_None — group complete!_}

## Commits

\`\`\`
${commit_log:-_No commits._}
\`\`\`"

  gh pr edit "$GROUP_PR_URL" --body "$pr_body" 2>/dev/null || {
    echo "WARNING: Failed to update PR body."
  }
}

# Mark the group draft PR as ready for review. Called when the last group plan completes.
finalize_group_pr() {
  local branch="$1"

  [[ -n "${GROUP_PR_URL:-}" ]] || return 0

  echo "Finalizing group PR..."

  # Push final commits
  if ! git push origin "$branch" 2>&1; then
    echo "WARNING: Failed to push. PR not finalized."
    return 0
  fi

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$branch" --oneline --no-decorate 2>/dev/null || true)

  # Build final completed plans list
  local completed_list=""
  local f
  for f in "$ARCHIVE_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    local fb
    fb=$(basename "$f")
    [[ "$fb" == progress-* ]] && continue
    completed_list="${completed_list}- ${fb} ✅
"
  done

  local pr_body="## Group: $GROUP_NAME

**Status:** Complete ($GROUP_PLANS_TOTAL/$GROUP_PLANS_TOTAL plans)

### Completed Plans
${completed_list:-_None._}

## Commits

\`\`\`
${commit_log:-_No commits._}
\`\`\`"

  gh pr edit "$GROUP_PR_URL" --body "$pr_body" 2>/dev/null || true

  # Mark PR as ready for review
  if gh pr ready "$GROUP_PR_URL" 2>/dev/null; then
    echo "PR marked as ready for review: $GROUP_PR_URL"
  else
    echo "WARNING: Failed to mark PR as ready. Mark it manually: gh pr ready $GROUP_PR_URL"
  fi

  cleanup_group_state
}

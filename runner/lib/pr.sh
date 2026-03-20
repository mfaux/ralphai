# pr.sh — PR lifecycle: archive, create, continuous PR management
# Sourced by ralphai.sh — do not execute directly.

# --- Archive function: move plan folder from in-progress/ to out/ ---
# Only called on actual completion (COMPLETE signal).
archive_run() {
  mkdir -p "$ARCHIVE_DIR"

  local plan_dir
  plan_dir=$(dirname "${WIP_FILES[0]}")
  local plan_slug
  plan_slug=$(basename "$plan_dir")

  # Read issue frontmatter before files are moved (needed for post-completion hooks)
  for f in "${WIP_FILES[@]}"; do
    if [[ -f "$f" ]]; then
      read_issue_frontmatter "$f"
      # Stop at the first file with github source frontmatter
      [[ "$PLAN_ISSUE_SOURCE" == "github" ]] && break
    fi
  done

  # Move plan folder from in-progress/ to out/
  local dest="$ARCHIVE_DIR/$plan_slug"
  mv "$plan_dir" "$dest"
  echo "Archived $plan_dir -> $dest"

  # Plan files are gitignored (local-only state), so no git operations needed.
  # The mv commands above are the entire archive step.

  # Post completion comment on linked issue and remove in-progress label
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
        gh issue edit "$PLAN_ISSUE_NUMBER" \
          --repo "$repo" \
          --remove-label "$ISSUE_IN_PROGRESS_LABEL" >/dev/null 2>&1 || true
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

  # Build a user-facing PR body from the commit log.
  # The plan file is an internal implementation detail and should not be
  # included verbatim. Reviewers care about *what changed and why*, which
  # the commit messages already capture.
  local pr_body=""

  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$branch" --oneline --no-decorate 2>/dev/null || true)

  pr_body="## Summary

${plan_desc}

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

# --- Build PR body for continuous mode ---
# Uses COMPLETED_PLANS array (set by caller) and scans backlog for remaining plans.
build_continuous_pr_body() {
  local body=""

  # Completed plans section
  body+="## Completed Plans"$'\n\n'
  if [[ ${#COMPLETED_PLANS[@]} -gt 0 ]]; then
    for p in "${COMPLETED_PLANS[@]}"; do
      body+="- [x] $p"$'\n'
    done
  else
    body+="_None yet._"$'\n'
  fi

  # Remaining plans section (scan backlog)
  local remaining=()
  local _remaining_plans=()
  collect_backlog_plans _remaining_plans
  for _rp in "${_remaining_plans[@]}"; do
    remaining+=("$(basename "$_rp")")
  done

  body+=$'\n'"## Remaining Plans"$'\n\n'
  if [[ ${#remaining[@]} -gt 0 ]]; then
    for r in "${remaining[@]}"; do
      body+="- [ ] $r"$'\n'
    done
  else
    body+="_Backlog empty — all plans processed._"$'\n'
  fi

  # Commit log
  local commit_log
  commit_log=$(git log "$BASE_BRANCH".."$(git rev-parse --abbrev-ref HEAD)" --oneline --no-decorate 2>/dev/null || true)
  body+=$'\n'"## Commits"$'\n\n'
  body+='```'$'\n'
  body+="${commit_log:-_No commits._}"$'\n'
  body+='```'

  echo "$body"
}

# --- Create draft PR for continuous mode (after first plan completes) ---
# Sets CONTINUOUS_PR_URL on success.
create_continuous_pr() {
  local branch="$1"
  local first_plan_desc="$2"

  echo ""
  echo "Creating draft PR for continuous run on '$branch'..."

  # Push branch to remote
  echo "Pushing $branch to origin..."
  if ! git push -u origin "$branch" 2>&1; then
    echo "WARNING: Failed to push branch. Branch left intact for manual push/PR."
    return 0
  fi

  local pr_body
  pr_body=$(build_continuous_pr_body)

  local pr_title="ralphai: ${first_plan_desc}"
  local pr_url
  pr_url=$(gh pr create \
    --base "$BASE_BRANCH" \
    --head "$branch" \
    --title "$pr_title" \
    --body "$pr_body" \
    --draft 2>&1) || {
    echo "WARNING: Failed to create draft PR: $pr_url"
    echo "Branch '$branch' pushed to origin. Create PR manually."
    return 0
  }

  CONTINUOUS_PR_URL="$pr_url"
  echo "Draft PR created: $pr_url"
}

# --- Update existing continuous PR (after subsequent plan completes) ---
update_continuous_pr() {
  local branch="$1"

  echo ""
  echo "Updating continuous PR..."

  # Push latest commits
  if ! git push origin "$branch" 2>&1; then
    echo "WARNING: Failed to push. Commits remain local."
    return 0
  fi

  if [[ -z "$CONTINUOUS_PR_URL" ]]; then
    echo "WARNING: No PR URL to update."
    return 0
  fi

  local pr_body
  pr_body=$(build_continuous_pr_body)

  gh pr edit "$CONTINUOUS_PR_URL" --body "$pr_body" 2>&1 || {
    echo "WARNING: Failed to update PR body."
  }

  echo "PR updated: $CONTINUOUS_PR_URL"
}

# --- Finalize continuous PR: mark ready for review ---
finalize_continuous_pr() {
  if [[ -z "$CONTINUOUS_PR_URL" ]]; then
    echo "WARNING: No continuous PR to finalize."
    return 0
  fi

  echo ""
  echo "All plans complete. Marking PR as ready for review..."

  # Update body one final time (remaining should now be empty)
  local pr_body
  pr_body=$(build_continuous_pr_body)

  gh pr edit "$CONTINUOUS_PR_URL" --body "$pr_body" 2>&1 || true
  gh pr ready "$CONTINUOUS_PR_URL" 2>&1 || {
    echo "WARNING: Failed to mark PR as ready."
  }

  echo "PR ready for review: $CONTINUOUS_PR_URL"
}

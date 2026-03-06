#!/bin/bash
# ralphai.sh — Ralphai (looped, autonomous)
# Drives an AI coding agent to autonomously implement tasks from plan files.
#
# Usage: ralphai run [turns-per-plan] [--dry-run] [--resume] [--agent-command=<cmd>] [--feedback-commands=<list>] [--base-branch=<branch>] [--direct] [--pr] [--max-stuck=<n>] [--show-config] [--help]
#
# Auto-detects what to work on:
#   1. If .ralphai/pipeline/in-progress/ has plan files → resume on the current ralphai/* branch
#   2. Otherwise, pick the best plan from .ralphai/pipeline/backlog/ (LLM-selected if multiple)
#
# On completion of a plan (PR mode, --pr): pushes the branch and creates
# a PR via 'gh' CLI. In direct mode (the default): commits on the current branch
# with no branch creation and no PR. Turn budget resets for each new plan.
#
# On turn exhaustion or stuck: exits, leaving files in in-progress/ for
# resume on a subsequent run.

set -e

# --- Source library modules ---
RALPHAI_LIB_DIR="$(dirname "$0")/lib"
source "$RALPHAI_LIB_DIR/defaults.sh"
source "$RALPHAI_LIB_DIR/config.sh"
source "$RALPHAI_LIB_DIR/issues.sh"
source "$RALPHAI_LIB_DIR/git.sh"
source "$RALPHAI_LIB_DIR/plans.sh"
source "$RALPHAI_LIB_DIR/prompt.sh"
source "$RALPHAI_LIB_DIR/pr.sh"

# ==========================================================================
# MAIN LOOP — pick a plan, run turns, merge on complete, repeat
# ==========================================================================

plans_completed=0

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "========================================"
  echo "  Ralphai dry-run — preview only"
  echo "========================================"

  if ! detect_plan; then
    echo "[dry-run] No runnable work found."
    exit 0
  fi

  PLAN_DESC=$(plan_description "${WIP_FILES[0]}")
  echo "[dry-run] Plan: $(basename "${WIP_FILES[0]}")"
  echo "[dry-run] Description: $PLAN_DESC"

  dry_group=$(extract_group "${WIP_FILES[0]}")
  if [[ -n "$dry_group" ]]; then
    echo "[dry-run] Group: $dry_group"
    echo "[dry-run] Branch would be: ralphai/$dry_group"
    dry_group_members=()
    mapfile -t dry_group_members < <(collect_group_plans "$dry_group")
    echo "[dry-run] Group plans (${#dry_group_members[@]} remaining in backlog + 1 selected):"
    echo "[dry-run]   1. $(basename "${WIP_FILES[0]}") (selected)"
    gn=2
    for gm in "${dry_group_members[@]}"; do
      echo "[dry-run]   $gn. $(basename "$gm")"
      gn=$((gn + 1))
    done
  fi

  if [[ "$RESUMING" == true ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    echo "[dry-run] Mode: resume in-progress"
    echo "[dry-run] Would run on current branch: $current_branch"
    echo "[dry-run] Would keep existing $PROGRESS_FILE"
  elif [[ "$MODE" == "direct" ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
      echo "[dry-run] ERROR: Direct mode cannot run on '$current_branch'."
      echo "[dry-run] Switch to a feature branch, or use --pr mode."
    else
      echo "[dry-run] Mode: direct — would commit on current branch '$current_branch' (no PR)"
    fi
    echo "[dry-run] Would initialize: $PROGRESS_FILE"
  else
    plan_basename=$(basename "${WIP_FILES[0]}")
    if [[ -n "${dry_group:-}" ]]; then
      branch="ralphai/${dry_group}"
    else
      slug="${plan_basename#prd-}"
      slug="${slug%.md}"
      branch="ralphai/${slug}"
    fi
    if git show-ref --verify --quiet "refs/heads/ralphai"; then
      echo "[dry-run] WARNING: Branch 'ralphai' exists and would block creation of '$branch'."
      echo "[dry-run] Fix: git branch -m ralphai ralphai-legacy  OR  git branch -D ralphai"
    fi
    if branch_has_open_work "$branch"; then
      echo "[dry-run] WARNING: $COLLISION_REASON"
      echo "[dry-run] This plan would be SKIPPED in a real run."
    fi
    echo "[dry-run] Mode: pr — would create branch from $BASE_BRANCH: $branch"
    echo "[dry-run] Would create PR via 'gh' on completion"
    echo "[dry-run] Would initialize: $PROGRESS_FILE"
  fi

  echo "[dry-run] No files moved, no branches created, no agent run executed."
  exit 0
fi

while true; do
  echo ""
  echo "========================================"
  echo "  Ralphai — detecting next task..."
  echo "========================================"

  if ! detect_plan; then
    if [[ $plans_completed -gt 0 ]]; then
      echo ""
      echo "All done. Completed $plans_completed plan(s) this session."
    fi
    exit 0
  fi

  # Get a description for merge commit messages
  PLAN_DESC=$(plan_description "${WIP_FILES[0]}")

  # --- Branch strategy ---
  if [[ "$RESUMING" == true ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$MODE" != "direct" && "$current_branch" == "$BASE_BRANCH" ]]; then
      echo "ERROR: Resuming requires being on a ralphai/* branch, not '$BASE_BRANCH'."
      echo "Checkout the branch you want to resume, then run again."
      exit 1
    fi
    branch="$current_branch"
    echo "Resuming on existing branch: $branch"

    # Preserve existing progress file
    echo "Resuming — keeping existing $PROGRESS_FILE"
  elif [[ "$MODE" == "direct" ]]; then
    # Direct mode: work on the current branch, no branch creation, no PR
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
      echo "ERROR: Direct mode cannot run on '$current_branch'."
      echo "Switch to a feature branch, or use --pr mode."
      # Roll back: move plan file back to backlog
      plan_basename=$(basename "${WIP_FILES[0]}")
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi
    branch="$current_branch"
    echo "Direct mode: working on current branch '$branch' (no PR will be created)"

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  else
    git checkout "$BASE_BRANCH"
    plan_basename=$(basename "${WIP_FILES[0]}")
    if [[ -n "${GROUP_NAME:-}" ]]; then
      # Group mode: branch named after the group
      branch="ralphai/${GROUP_NAME}"
    else
      # Normal mode: branch named after the plan
      slug="${plan_basename#prd-}"
      slug="${slug%.md}"
      branch="ralphai/${slug}"
    fi

    # Guard: a bare "ralphai" branch blocks all "ralphai/*" branches (git ref hierarchy conflict)
    if git show-ref --verify --quiet "refs/heads/ralphai"; then
      echo ""
      echo "ERROR: Branch 'ralphai' exists and blocks creation of '$branch'."
      echo "Git cannot create 'ralphai/<slug>' when a branch named 'ralphai' already exists."
      echo ""
      echo "Fix: delete or rename the stale branch, then retry:"
      echo "  git branch -m ralphai ralphai-legacy   # rename"
      echo "  git branch -D ralphai                # or delete"
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo ""
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi

    # Safety: check for existing branch/PR collision
    if branch_has_open_work "$branch"; then
      echo ""
      echo "SKIP: $COLLISION_REASON"
      echo "Plan '$plan_basename' already has open work. Skipping to next plan."
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      SKIPPED_PLANS["$plan_basename"]=1
      continue
    fi
    if ! git checkout -b "$branch"; then
      echo ""
      echo "ERROR: Failed to create branch '$branch'."
      # Roll back: move plan file back to backlog
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi
    echo "Created branch from $BASE_BRANCH: $branch"

    # Update group state with branch name
    if [[ -n "${GROUP_NAME:-}" && -f "$GROUP_STATE_FILE" ]]; then
      GROUP_BRANCH="$branch"
      write_group_state \
        "group=$GROUP_NAME" \
        "branch=$GROUP_BRANCH" \
        "plans_total=$GROUP_PLANS_TOTAL" \
        "plans_completed=$GROUP_PLANS_COMPLETED" \
        "current_plan=$GROUP_CURRENT_PLAN" \
        "pr_url=${GROUP_PR_URL:-}"
    fi

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  fi

  # --- Turn loop (per-plan) ---
  stuck_count=0
  last_hash=$(git rev-parse HEAD)
  completed=false

  i=0
  while [[ "$TURNS" -eq 0 ]] || [[ "$i" -lt "$TURNS" ]]; do
    i=$((i + 1))
    echo ""
    if [[ "$TURNS" -eq 0 ]]; then
      echo "=== Ralphai turn $i (unlimited) (plan: $(basename "${WIP_FILES[0]}")) ==="
    else
      echo "=== Ralphai turn $i of $TURNS (plan: $(basename "${WIP_FILES[0]}")) ==="
    fi

    PROMPT="${FILE_REFS} $(format_file_ref "${PROGRESS_FILE}")${LEARNINGS_REF}
1. Read the referenced files and the progress file.${LEARNINGS_HINT}
2. Find the highest-priority incomplete task (see prioritization rules in the plan).
3. Implement it with small, focused changes. Testing strategy depends on task type:
   - Bug fix: Write a failing test FIRST that reproduces the bug, then fix the code to make it pass.
   - New feature: Implement the feature, then add tests that cover the new code.
   - Refactor: Verify existing tests pass before and after. Only add tests if you discover coverage gaps.
4. $(if [[ -n "$FEEDBACK_COMMANDS_TEXT" ]]; then echo "Run all feedback loops: ${FEEDBACK_COMMANDS_TEXT}. Fix any failures before continuing."; else echo "Run your project's build, test, and lint commands. Fix any failures before continuing."; fi)
5. Documentation: Review whether your changes affect any documentation. Update these files if they are outdated or incomplete:
   - README.md (commands, usage, feature descriptions)
   - AGENTS.md — only if your work created knowledge that future coding agents need and cannot easily infer from the code (e.g. new CLI commands, non-obvious architectural constraints, changed dev workflows). Routine bug fixes, internal refactors, and new tests do not warrant an AGENTS.md update.
  - LEARNINGS.md docs: preserve the two-tier model (.ralphai/LEARNINGS.md for Ralphai logs, repo-level LEARNINGS.md for maintainer-curated durable guidance).
  - Project documentation files that describe architecture, conventions, agent instructions, or reusable skills — update only if your changes affect them.
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.${LEARNINGS_STEP}
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "7"; else echo "6"; fi). Update ${PROGRESS_FILE} with what you did, decisions made, files changed, and any blockers.
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "8"; else echo "7"; fi). Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish a turn with uncommitted changes.
ONLY WORK ON A SINGLE TASK.
If all tasks are complete, output <promise>COMPLETE</promise> — but ONLY after committing. Never output COMPLETE with uncommitted changes."

    agent_output_file=$(mktemp)
    set +e
    if [[ "$TURN_TIMEOUT" -gt 0 ]]; then
      timeout "$TURN_TIMEOUT" $AGENT_COMMAND "$PROMPT" 2>&1 | tee "$agent_output_file"
      agent_exit=${PIPESTATUS[0]}
      if [[ $agent_exit -eq 124 ]]; then
        echo ""
        echo "WARNING: Agent command timed out after ${TURN_TIMEOUT}s."
      fi
    else
      $AGENT_COMMAND "$PROMPT" 2>&1 | tee "$agent_output_file"
      agent_exit=${PIPESTATUS[0]}
    fi
    set -e
    result=$(<"$agent_output_file")
    rm -f "$agent_output_file"

    if [[ $agent_exit -ne 0 && $agent_exit -ne 124 ]]; then
      echo ""
      echo "WARNING: Agent command exited with status $agent_exit."
    fi

    # --- Stuck detection (BEFORE auto-commit to avoid false progress) ---    current_hash=$(git rev-parse HEAD)
    if [[ "$current_hash" == "$last_hash" ]]; then
      stuck_count=$((stuck_count + 1))
      echo "WARNING: No new commits this turn ($stuck_count/$MAX_STUCK)."
      if [[ $stuck_count -ge $MAX_STUCK ]]; then
        echo "ERROR: $MAX_STUCK consecutive turns with no progress. Aborting."
        echo "Branch: $branch"
        if [[ -n "${GROUP_NAME:-}" && "$MODE" == "pr" ]]; then
          echo "Group '$GROUP_NAME' halted at plan: $GROUP_CURRENT_PLAN"
          echo "Pushing partial work and creating/updating draft PR..."
          git push origin "$branch" 2>/dev/null || true
          if [[ -z "${GROUP_PR_URL:-}" ]]; then
            create_group_pr "$branch" "$GROUP_NAME"
            # Append failure note to PR body
            if [[ -n "${GROUP_PR_URL:-}" ]]; then
              fail_body=$(gh pr view "$GROUP_PR_URL" --json body -q .body 2>/dev/null || true)
              gh pr edit "$GROUP_PR_URL" --body "${fail_body}

---
⚠️ **Group halted:** Plan \`$GROUP_CURRENT_PLAN\` stuck after $MAX_STUCK turns with no commits. Remaining plans not attempted. Resume with \`--resume\` or investigate manually." 2>/dev/null || true
            fi
          else
            update_group_pr "$branch" "$GROUP_CURRENT_PLAN"
            gh pr edit "$GROUP_PR_URL" --body "$(gh pr view "$GROUP_PR_URL" --json body -q .body 2>/dev/null || true)

---
⚠️ **Group halted:** Plan \`$GROUP_CURRENT_PLAN\` stuck after $MAX_STUCK turns with no commits. Remaining plans not attempted. Resume with \`--resume\` or investigate manually." 2>/dev/null || true
          fi
          echo "Group state preserved in $GROUP_STATE_FILE for --resume."
        else
          echo "Plan files remain in $WIP_DIR/ — resume with another run."
        fi
        exit 1
      fi
    else
      stuck_count=0
      last_hash="$current_hash"
    fi

    # --- Auto-commit dirty state (AFTER stuck detection) ---
    if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      echo "WARNING: Agent left uncommitted changes. Auto-committing recovery snapshot."
      git add -A
      git commit -m "chore(ralphai): auto-commit uncommitted changes from turn $i" || true
    fi

    # --- Check for completion ---
    if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
      echo ""
      echo "Plan complete after $i turns: $PLAN_DESC"
      archive_run

      if [[ -n "${GROUP_NAME:-}" ]]; then
        # Group mode: create or update draft PR before advancing
        if [[ "$MODE" == "pr" ]]; then
          if [[ -z "${GROUP_PR_URL:-}" ]]; then
            # First group plan completed — create draft PR
            create_group_pr "$branch" "$GROUP_NAME"
          else
            # Subsequent plan completed — update PR body
            update_group_pr "$branch" "$GROUP_CURRENT_PLAN"
          fi
        fi

        # Group mode: try to advance to next plan
        if advance_group_plan; then
          echo ""
          echo "=== Continuing group '$GROUP_NAME': $(basename "${WIP_FILES[0]}") ==="
          # Reset turn tracking for next plan
          i=0
          stuck_count=0
          last_hash=$(git rev-parse HEAD)
          # Re-initialize progress file for the new plan
          echo "## Progress Log" > "$PROGRESS_FILE"
          echo "" >> "$PROGRESS_FILE"
          echo "Initialized $PROGRESS_FILE for $(basename "${WIP_FILES[0]}")"
          continue  # Continue the turn loop with the new plan
        fi

        # Group complete
        if [[ "$MODE" == "pr" ]]; then
          finalize_group_pr "$branch"
        else
          cleanup_group_state
          echo "Group '$GROUP_NAME' complete. Direct mode: commits are on branch '$branch'."
          echo "Tip: use --pr to automatically create a branch and open a pull request."
        fi
      fi

      if [[ -z "${GROUP_NAME:-}" ]]; then
        if [[ "$MODE" == "pr" ]]; then
          create_pr "$branch" "$PLAN_DESC"
        else
          echo "Direct mode: commits are on branch '$branch'. No PR created."
          echo "Tip: use --pr to automatically create a branch and open a pull request."
        fi
      fi
      plans_completed=$((plans_completed + 1))
      completed=true
      break
    fi
  done

  if [[ "$completed" == false ]]; then
    echo ""
    echo "Finished $TURNS turns without completing: $PLAN_DESC"
    if [[ -n "${GROUP_NAME:-}" && "$MODE" == "pr" ]]; then
      echo "Group '$GROUP_NAME' halted at plan: $GROUP_CURRENT_PLAN"
      git push origin "$branch" 2>/dev/null || true
      if [[ -z "${GROUP_PR_URL:-}" ]]; then
        create_group_pr "$branch" "$GROUP_NAME"
      else
        update_group_pr "$branch" "$GROUP_CURRENT_PLAN"
      fi
      echo "Group state preserved for --resume."
    else
      echo "Plan files remain in $WIP_DIR/ — resume with another run."
    fi
    echo "Branch: $branch"
    exit 0
  fi

  # Loop back to pick the next plan (turn budget resets)
done

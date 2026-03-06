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
source "$RALPHAI_LIB_DIR/learnings.sh"
source "$RALPHAI_LIB_DIR/pr.sh"

# ==========================================================================
# MAIN LOOP — pick a plan, run turns, merge on complete, repeat
# ==========================================================================

plans_completed=0
COMPLETED_PLANS=()
CONTINUOUS_BRANCH=""
CONTINUOUS_PR_URL=""

# --- Early guard: direct mode cannot run on main/master ---
if [[ "$MODE" == "direct" ]]; then
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current_branch" == "main" || "$current_branch" == "master" ]]; then
    echo "Direct mode cannot run on '$current_branch'."
    echo ""
    echo "Either run in PR mode (a branch and pull request are created for you):"
    echo "  ralphai run --pr"
    # Peek at backlog to suggest a branch name
    _first_plan=""
    for _f in "$BACKLOG_DIR"/*.md; do
      [[ -f "$_f" ]] && _first_plan="$_f" && break
    done
    if [[ -n "$_first_plan" ]]; then
      _slug=$(basename "$_first_plan")
      _slug="${_slug#prd-}"
      _slug="${_slug%.md}"
      echo ""
      if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
        echo "Or create a worktree on a feature branch:"
        echo "  git worktree add ../<dir> -b ralphai/${_slug} $current_branch"
      else
        echo "Or switch to a feature branch:"
        echo "  git checkout -b ralphai/${_slug}"
      fi
    else
      echo ""
      if [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
        echo "Or create a worktree on a feature branch:"
        echo "  git worktree add ../<dir> -b ralphai/<name> $current_branch"
      else
        echo "Or switch to a feature branch first."
      fi
    fi
    exit 1
  fi
fi

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

  if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" ]]; then
    echo "[dry-run] Continuous+PR mode: all backlog plans will run on a single branch with one PR."
  fi

  if [[ "$RESUMING" == true ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    echo "[dry-run] Mode: resume in-progress"
    echo "[dry-run] Would run on current branch: $current_branch"
    echo "[dry-run] Would keep existing $PROGRESS_FILE"
  elif [[ "$MODE" == "direct" ]]; then
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    echo "[dry-run] Mode: direct — would commit on current branch '$current_branch' (no PR)"
    echo "[dry-run] Would initialize: $PROGRESS_FILE"
  else
    plan_basename=$(basename "${WIP_FILES[0]}")
    slug="${plan_basename#prd-}"
    slug="${slug%.md}"
    branch="ralphai/${slug}"
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

  if [[ ${#FALLBACK_CHAIN[@]} -gt 0 ]]; then
    echo "[dry-run] Fallback chain (${#FALLBACK_CHAIN[@]} agent(s)):"
    for fi_idx in "${!FALLBACK_CHAIN[@]}"; do
      echo "[dry-run]   $((fi_idx + 1)). ${FALLBACK_CHAIN[$fi_idx]}"
    done
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
      # Finalize continuous PR when backlog is drained
      if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" && -n "$CONTINUOUS_PR_URL" ]]; then
        finalize_continuous_pr
      fi
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
    branch=$(git rev-parse --abbrev-ref HEAD)
    echo "Direct mode: working on current branch '$branch' (no PR will be created)"

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  elif [[ "$CONTINUOUS" == "true" && -n "$CONTINUOUS_BRANCH" ]]; then
    # Continuous+PR mode, subsequent plan: reuse the existing branch
    branch="$CONTINUOUS_BRANCH"
    echo "Continuous mode: continuing on branch '$branch'"

    # Re-initialize progress file for the new plan
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  elif [[ "$RALPHAI_IS_WORKTREE" == true ]]; then
    # Worktree mode: the user already created the worktree on the right branch.
    # Do not create branches or switch — just validate.
    branch=$(git rev-parse --abbrev-ref HEAD)
    plan_basename=$(basename "${WIP_FILES[0]}")

    if [[ "$branch" == "$BASE_BRANCH" ]]; then
      echo "ERROR: Running in a worktree on the base branch '$BASE_BRANCH'."
      echo "Create a worktree on a feature branch instead:"
      slug="${plan_basename#prd-}"
      slug="${slug%.md}"
      echo "  git worktree add ../<dir> -b ralphai/${slug} $BASE_BRANCH"
      # Roll back plan
      rollback_dest="$BACKLOG_DIR/${plan_basename}"
      mv "${WIP_FILES[0]}" "$rollback_dest"
      echo "Rolled back: moved plan to $rollback_dest"
      exit 1
    fi
    echo "Worktree mode: working on existing branch '$branch' (no checkout)"

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  else
    git checkout "$BASE_BRANCH"
    plan_basename=$(basename "${WIP_FILES[0]}")
    slug="${plan_basename#prd-}"
    slug="${slug%.md}"
    branch="ralphai/${slug}"

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

    # In continuous+PR mode, remember this branch for subsequent plans
    if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" ]]; then
      CONTINUOUS_BRANCH="$branch"
    fi

    # Initialize progress file
    mkdir -p "$WIP_DIR"
    echo "## Progress Log" > "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
    echo "Initialized $PROGRESS_FILE"
  fi

  # --- Per-plan agent override ---
  GLOBAL_AGENT_COMMAND="$AGENT_COMMAND"
  plan_agent=$(extract_plan_agent "${WIP_FILES[0]}" 2>/dev/null || true)
  if [[ -n "$plan_agent" ]]; then
    AGENT_COMMAND="$plan_agent"
    detect_agent_type
    resolve_prompt_mode
    echo "Using plan-specific agent: $plan_agent"
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
   - Project documentation files that describe architecture, conventions, agent instructions, or reusable skills — update only if your changes affect them.
   Only update docs that are actually affected by your changes — do not rewrite docs unnecessarily.${LEARNINGS_STEP}
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "7"; else echo "6"; fi). Update ${PROGRESS_FILE} with what you did, decisions made, files changed, and any blockers.
$(if [[ -n "$LEARNINGS_STEP" ]]; then echo "8"; else echo "7"; fi). Stage and commit ALL changes using a conventional commit message (e.g. feat: ..., fix: ..., refactor: ..., test: ..., docs: ..., chore: ...). Use a scope when appropriate (e.g. feat(parser): ...). This is MANDATORY — you must never finish a turn with uncommitted changes.
ONLY WORK ON A SINGLE TASK.
If all tasks are complete, output <promise>COMPLETE</promise> — but ONLY after committing. Never output COMPLETE with uncommitted changes.
REQUIRED: At the very end of your response, include a <learnings> block. If you made a mistake or learned something this turn, use:
<learnings>
<entry>
status: logged
date: YYYY-MM-DD
title: Short description
what: What went wrong
root_cause: Why it happened
prevention: How to avoid it
</entry>
</learnings>
If no learnings this turn, use:
<learnings>
<entry>
status: none
</entry>
</learnings>
The <learnings> block is mandatory in every response. Ralphai will parse it and persist logged entries automatically."

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

    # --- Process learnings block (before completion check) ---
    process_learnings "$result"

    if [[ $agent_exit -ne 0 && $agent_exit -ne 124 ]]; then
      echo ""
      echo "WARNING: Agent command exited with status $agent_exit."
    fi

    # --- Stuck detection (BEFORE auto-commit to avoid false progress) ---
    current_hash=$(git rev-parse HEAD)
    if [[ "$current_hash" == "$last_hash" ]]; then
      stuck_count=$((stuck_count + 1))
      echo "WARNING: No new commits this turn ($stuck_count/$MAX_STUCK)."
      if [[ $stuck_count -ge $MAX_STUCK ]]; then
        # --- Fallback agent rotation ---
        if [[ $FALLBACK_INDEX -lt ${#FALLBACK_CHAIN[@]} ]]; then
          next_agent="${FALLBACK_CHAIN[$FALLBACK_INDEX]}"
          FALLBACK_INDEX=$((FALLBACK_INDEX + 1))
          echo ""
          echo "Agent stuck after $MAX_STUCK iterations with no progress."
          echo "Switching to fallback agent: $next_agent"
          AGENT_COMMAND="$next_agent"
          detect_agent_type
          resolve_prompt_mode
          stuck_count=0
          # Log switch to progress file
          if [[ -n "${PROGRESS_FILE:-}" && -f "$PROGRESS_FILE" ]]; then
            echo "" >> "$PROGRESS_FILE"
            echo "--- Agent switch (stuck after $MAX_STUCK iterations) ---" >> "$PROGRESS_FILE"
            echo "Switched to fallback agent: $next_agent" >> "$PROGRESS_FILE"
            echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$PROGRESS_FILE"
          fi
        else
          echo "ERROR: $MAX_STUCK consecutive turns with no progress. All fallback agents exhausted."
          echo "Branch: $branch"
          echo "Plan files remain in $WIP_DIR/ — resume with another run."
          # In continuous+PR mode, push partial work
          if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" && -n "$CONTINUOUS_BRANCH" ]]; then
            echo "Pushing partial work to continuous branch..."
            git push origin "$branch" 2>&1 || true
          fi
          AGENT_COMMAND="$GLOBAL_AGENT_COMMAND"
          detect_agent_type
          resolve_prompt_mode
          exit 1
        fi
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
      COMPLETED_PLANS+=("$(basename "${WIP_FILES[0]}")")
      archive_run

      if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" ]]; then
        # Continuous+PR mode: create draft PR on first plan, update on subsequent
        if [[ -z "$CONTINUOUS_PR_URL" ]]; then
          create_continuous_pr "$branch" "$PLAN_DESC"
        else
          update_continuous_pr "$branch"
        fi
      elif [[ "$MODE" == "pr" ]]; then
        create_pr "$branch" "$PLAN_DESC"
      else
        echo "Direct mode: commits are on branch '$branch'. No PR created."
        echo "Tip: use --pr to automatically create a branch and open a pull request."
      fi
      plans_completed=$((plans_completed + 1))
      completed=true
      break
    fi
  done

  # --- Restore global agent command after plan completes ---
  AGENT_COMMAND="$GLOBAL_AGENT_COMMAND"
  detect_agent_type
  resolve_prompt_mode

  if [[ "$completed" == false ]]; then
    echo ""
    echo "Finished $TURNS turns without completing: $PLAN_DESC"
    echo "Plan files remain in $WIP_DIR/ — resume with another run."
    echo "Branch: $branch"
    # In continuous+PR mode, push partial work and update PR
    if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" ]]; then
      if [[ -n "$CONTINUOUS_PR_URL" ]]; then
        echo "Pushing partial work to continuous PR..."
        git push origin "$branch" 2>&1 || true
      elif [[ $plans_completed -gt 0 ]]; then
        echo "Pushing partial work..."
        git push origin "$branch" 2>&1 || true
      fi
    fi
    exit 0
  fi

  # --- Non-continuous modes: stop after one plan ---
  if [[ "$CONTINUOUS" != "true" ]]; then
    if [[ "$MODE" == "direct" ]]; then
      echo ""
      echo "Plan complete. Direct mode stops after one plan by default."
      echo "Tip: use --continuous to keep processing backlog plans."
    fi
    exit 0
  fi

  # Loop back to pick the next plan (turn budget resets)
done

# --- Continuous mode: finalize PR when backlog is drained ---
if [[ "$CONTINUOUS" == "true" && "$MODE" == "pr" && -n "$CONTINUOUS_PR_URL" ]]; then
  finalize_continuous_pr
fi

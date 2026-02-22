#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this command inside a git repository."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit/stash changes before syncing main."
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Local branch 'main' does not exist."
  exit 1
fi

if ! git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  echo "Remote branch 'origin/main' does not exist or cannot be reached."
  exit 1
fi

git fetch origin --prune

local_only_main_commits="$(git rev-list --count main --not origin/main)"
backup_branch=""
if (( local_only_main_commits > 0 )); then
  backup_branch="backup-main-local-$(date +%Y%m%d-%H%M%S)"
  git switch -c "$backup_branch" main >/dev/null
  echo "Backed up ${local_only_main_commits} local-only main commit(s) to '$backup_branch'."
fi

current_branch="$(git branch --show-current)"
temp_branch=""
if [[ "$current_branch" == "main" ]]; then
  temp_branch="codex/tmp-main-sync-$(date +%Y%m%d-%H%M%S)"
  git switch -c "$temp_branch" main >/dev/null
fi

git branch -f main origin/main >/dev/null
git switch main >/dev/null

if [[ -n "$temp_branch" ]]; then
  git branch -D "$temp_branch" >/dev/null
fi

read -r ahead behind <<<"$(git rev-list --left-right --count main...origin/main)"
echo "main synced. ahead=${ahead}, behind=${behind}"
if [[ -n "$backup_branch" ]]; then
  echo "Backup branch preserved: $backup_branch"
fi

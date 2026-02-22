#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/git-start-task.sh <task-name>"
  echo "Example: scripts/git-start-task.sh fix-player-search"
  exit 1
fi

task_slug="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
if [[ ! "$task_slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Invalid task name. Use lowercase letters, numbers, and hyphens only."
  exit 1
fi

branch_name="codex/${task_slug}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${script_dir}/git-sync-main.sh"

if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
  echo "Branch '${branch_name}' already exists locally."
  echo "Switch to it with: git switch ${branch_name}"
  exit 1
fi

git switch -c "${branch_name}" origin/main
echo "Created and switched to '${branch_name}' from origin/main."

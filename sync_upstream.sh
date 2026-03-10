#!/usr/bin/env bash
set -euo pipefail

# Sync helper for importing selective changes from an "upstream" repository.
#
# What it does:
# 1) Ensures upstream remote exists (adds it if missing).
# 2) Fetches upstream.
# 3) Optionally creates/switches to a sync branch.
# 4) Shows commit and file-level diffs to decide what to cherry-pick.
#
# Usage examples:
#   ./sync_upstream.sh
#   ./sync_upstream.sh --upstream-url https://github.com/CarlosTMS/Schedule-app.git
#   ./sync_upstream.sh --base-branch main --upstream-branch main
#   ./sync_upstream.sh --no-branch

REMOTE_NAME="upstream"
UPSTREAM_URL="https://github.com/CarlosTMS/Schedule-app.git"
UPSTREAM_BRANCH="main"
BASE_BRANCH=""
CREATE_BRANCH="true"
SYNC_BRANCH_NAME=""

print_help() {
  cat <<'EOF'
sync_upstream.sh

Options:
  --remote-name <name>       Upstream remote name (default: upstream)
  --upstream-url <url>       Upstream repository URL
  --upstream-branch <name>   Upstream branch to compare against (default: main)
  --base-branch <name>       Local base branch for comparison (default: current branch)
  --sync-branch <name>       Sync branch name (default: sync/upstream-YYYY-MM-DD)
  --no-branch                Do not create/switch branch
  -h, --help                 Show this help

After running:
  - Review "candidate commits" output.
  - Cherry-pick selected commits with:
      git cherry-pick -x <sha>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote-name)
      REMOTE_NAME="$2"
      shift 2
      ;;
    --upstream-url)
      UPSTREAM_URL="$2"
      shift 2
      ;;
    --upstream-branch)
      UPSTREAM_BRANCH="$2"
      shift 2
      ;;
    --base-branch)
      BASE_BRANCH="$2"
      shift 2
      ;;
    --sync-branch)
      SYNC_BRANCH_NAME="$2"
      shift 2
      ;;
    --no-branch)
      CREATE_BRANCH="false"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Use --help to see valid options."
      exit 1
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: this script must run inside a git repository."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$CURRENT_BRANCH"
fi

if [[ -z "$SYNC_BRANCH_NAME" ]]; then
  SYNC_BRANCH_NAME="sync/upstream-$(date +%F)"
fi

echo "==> Current branch: ${CURRENT_BRANCH}"
echo "==> Base branch: ${BASE_BRANCH}"
echo "==> Upstream target: ${REMOTE_NAME}/${UPSTREAM_BRANCH}"

if git remote get-url "${REMOTE_NAME}" >/dev/null 2>&1; then
  EXISTING_URL="$(git remote get-url "${REMOTE_NAME}")"
  echo "==> Remote '${REMOTE_NAME}' already exists: ${EXISTING_URL}"
else
  echo "==> Adding remote '${REMOTE_NAME}' -> ${UPSTREAM_URL}"
  git remote add "${REMOTE_NAME}" "${UPSTREAM_URL}"
fi

echo "==> Fetching ${REMOTE_NAME}..."
git fetch "${REMOTE_NAME}"

if [[ "${CREATE_BRANCH}" == "true" ]]; then
  echo "==> Preparing sync branch: ${SYNC_BRANCH_NAME}"
  if git show-ref --verify --quiet "refs/heads/${SYNC_BRANCH_NAME}"; then
    git switch "${SYNC_BRANCH_NAME}"
  else
    git switch -c "${SYNC_BRANCH_NAME}" "${BASE_BRANCH}"
  fi
fi

echo
echo "==> Candidate commits in ${REMOTE_NAME}/${UPSTREAM_BRANCH} not in current HEAD:"
git log --oneline --left-right --cherry-pick --no-merges HEAD..."${REMOTE_NAME}/${UPSTREAM_BRANCH}" || true

echo
echo "==> File-level diff summary (current HEAD -> ${REMOTE_NAME}/${UPSTREAM_BRANCH}):"
git diff --name-status HEAD.."${REMOTE_NAME}/${UPSTREAM_BRANCH}" || true

echo
cat <<'EOF'
Next steps:
1) Pick commit(s) from the list:
   git cherry-pick -x <sha>
2) Resolve conflicts if any.
3) Validate:
   npm run build
   npm run lint
EOF

#!/usr/bin/env bash
# update-from-upstream.sh
# Safely pull changes from outline/outline (upstream) into the local fork.
#
# Usage:
#   ./scripts/update-from-upstream.sh              # fetch + merge
#   ./scripts/update-from-upstream.sh --rebase     # fetch + rebase (cleaner history)
#
# Behavior:
#   - Fetches upstream/main
#   - If no new commits: exit cleanly
#   - Attempts merge (or rebase)
#   - On CONFLICT: aborts the merge, lists conflicted files, exits non-zero.
#     User must then ask Claude to resolve conflicts, then run the script again.
#   - On clean merge: optionally rebuilds and restarts the service (skipped by default).

set -euo pipefail

cd "$(dirname "$0")/.."

USE_REBASE=false
if [[ "${1:-}" == "--rebase" ]]; then
  USE_REBASE=true
fi

# 1. Sanity checks
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "❌ Remote 'upstream' chưa được setup."
  echo "   Chạy: git remote add upstream https://github.com/outline/outline.git"
  exit 1
fi

CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "❌ Bạn đang ở branch '$CURRENT_BRANCH'. Hãy chuyển về main trước:"
  echo "   git checkout main"
  exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "❌ Có thay đổi chưa commit. Hãy commit hoặc stash trước:"
  git status --short
  exit 1
fi

echo "📥 Fetching upstream..."
git fetch upstream --prune

UPSTREAM_MAIN="upstream/main"
LOCAL_MAIN="origin/main"
BEHIND=$(git rev-list --count "$LOCAL_MAIN".."$UPSTREAM_MAIN" 2>/dev/null || echo 0)
AHEAD=$(git rev-list --count "$UPSTREAM_MAIN".."$LOCAL_MAIN" 2>/dev/null || echo 0)

if [[ "$BEHIND" -eq 0 ]]; then
  echo "✅ Đã up-to-date với upstream. Không có gì mới."
  exit 0
fi

echo "📊 Trạng thái:"
echo "   Upstream ahead of local: $BEHIND commits"
echo "   Local ahead of upstream: $AHEAD commits"

# Save backup ref just in case
BACKUP_REF="backup/pre-merge-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_REF" >/dev/null
echo "💾 Backup branch: $BACKUP_REF"

# 2. Merge or rebase
if $USE_REBASE; then
  echo "🔀 Rebasing onto upstream/main..."
  if ! git rebase "$UPSTREAM_MAIN"; then
    echo ""
    echo "❌ REBASE CONFLICT!"
    echo ""
    echo "Các file bị conflict:"
    git diff --name-only --diff-filter=U || true
    echo ""
    echo "Bước tiếp theo:"
    echo "  1. Mở Claude Code, gõ: 'Resolve rebase conflicts in <file>'"
    echo "  2. Sau khi fix, chạy: git add <file>"
    echo "  3. Chạy: git rebase --continue"
    echo "  4. Chạy lại script này để verify"
    echo ""
    echo "Nếu muốn hủy rebase: git rebase --abort"
    echo "Backup branch cũ vẫn còn: $BACKUP_REF"
    exit 2
  fi
else
  echo "🔀 Merging upstream/main..."
  if ! git merge --no-ff "$UPSTREAM_MAIN" -m "Merge upstream/outline @ $(date +%Y-%m-%d)"; then
    echo ""
    echo "❌ MERGE CONFLICT!"
    echo ""
    echo "Các file bị conflict:"
    git diff --name-only --diff-filter=U || true
    echo ""
    echo "Bước tiếp theo:"
    echo "  1. Mở Claude Code, paste đoạn này:"
    echo ""
    echo "     'Resolve merge conflicts in:"
    git diff --name-only --diff-filter=U | sed 's/^/       - /'
    echo "      Ưu tiên: giữ customizations của mình, áp dụng changes từ upstream.'"
    echo ""
    echo "  2. Sau khi Claude fix xong, chạy:"
    echo "     git add <file>"
    echo "     git commit"
    echo ""
    echo "Nếu muốn hủy merge: git merge --abort"
    echo "Backup branch cũ vẫn còn: $BACKUP_REF"
    exit 2
  fi
fi

echo ""
echo "✅ Merge/rebase thành công!"
echo ""
echo "📝 Commits mới:"
git log --oneline -"$BEHIND" 2>/dev/null | head -10 || git log --oneline -10

# 3. Build + restart prompt
echo ""
echo "🔨 Build + restart:"
echo "   cd /home/lucas/Documents/code/outline"
echo "   yarn install  # nếu package.json thay đổi"
echo "   yarn build"
echo "   # Sau đó restart service (systemd/pm2/Docker — tùy bạn setup)"

echo ""
echo "💡 Muốn build tự động? Chạy: ./scripts/update-from-upstream.sh --build"
echo "   (chưa implement — sẽ cần configure service manager trước)"

# Cleanup backup if everything OK
read -p "🗑️  Xóa backup branch $BACKUP_REF? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  git branch -D "$BACKUP_REF"
  echo "✓ Đã xóa backup"
fi

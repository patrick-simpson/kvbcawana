#!/bin/sh
# Stop hook — blocks Claude from ending a turn while there are
# unpushed commits on the main branch of this repo. Enforces the
# convention in CLAUDE.md: every code change commits AND pushes to
# main in the same turn so the Pages deploy stays fresh.

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0

# Not a git repo? Nothing to enforce.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Only enforce on main. Other branches (e.g. Claude's sandbox branch
# before the first push) shouldn't block.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$branch" = "main" ] || exit 0

# If origin/main isn't known locally there's nothing to compare.
git rev-parse --verify --quiet origin/main >/dev/null 2>&1 || exit 0

unpushed=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
[ -n "$unpushed" ] && [ "$unpushed" -gt 0 ] 2>/dev/null || exit 0

echo "Blocked: $unpushed unpushed commit(s) on main. Run: git push origin main" >&2
exit 2

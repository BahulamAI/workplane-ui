#!/usr/bin/env bash
# Publish the Workplane packages to npm, in dependency order.
#
# Order matters: npm resolves a dependency at publish time, so a package whose
# dependency is not yet on the registry will publish with a range nobody can
# install. protocol has no dependencies and goes first.
#
# Usage:
#   ./scripts/publish.sh --dry-run      # inspect what would be published
#   ./scripts/publish.sh                # publish for real
#
# Requires: npm login  (as a maintainer of the @bahulam scope)
set -euo pipefail

DRY=""
TAG="latest"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY="--dry-run" ;;
    --tag=*)   TAG="${arg#*=}" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

# Dependency order. Do not reorder without checking the dependency graph.
PACKAGES=(protocol data core react renderer-echarts testkit adapter-bahulam)

if [ -z "$DRY" ]; then
  who=$(npm whoami 2>/dev/null || true)
  if [ -z "$who" ]; then
    echo "Not logged in to npm. Run 'npm login' first." >&2
    exit 1
  fi
  echo "Publishing as: $who"
  echo "Tag: $TAG"
  echo
  read -r -p "This is permanent — npm does not allow unpublishing after 72 hours. Continue? [y/N] " reply
  case "$reply" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac
fi

echo "Building and verifying before publish..."
pnpm build
pnpm test
node scripts/check-dependency-rules.mjs

for name in "${PACKAGES[@]}"; do
  echo
  echo "=== packages/$name ==="
  # pnpm rewrites workspace:* to the real version in the published manifest.
  ( cd "packages/$name" && pnpm publish --access public --tag "$TAG" --no-git-checks $DRY )
done

echo
if [ -n "$DRY" ]; then
  echo "Dry run complete. Nothing was published."
else
  echo "Published. Verify with:"
  for name in "${PACKAGES[@]}"; do
    pkg=$(node -p "require('./packages/$name/package.json').name")
    echo "  npm view $pkg version"
  done
fi

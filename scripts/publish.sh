#!/usr/bin/env bash
# Publish @bahulam/workplane-ui to npm.
#
# ONE package with several entry points, not one per source directory. The
# directories under packages/workplane-ui/src express the architectural
# boundaries from PRD section 6.2 and are enforced by `pnpm lint:boundaries`;
# they are not separate releases. PRD section 7.1: "Directories express
# architectural boundaries; they do not require separate releases before those
# boundaries are stable."
#
# Usage:
#   ./scripts/publish.sh --dry-run          inspect, publish nothing
#   ./scripts/publish.sh --otp=123456       publish (2FA is on this account)
#   ./scripts/publish.sh --tag=next --otp=… publish under a dist-tag
#
# To avoid OTPs (CI, repeat releases): create a granular access token with
# publish rights on the @bahulam scope and set it in ~/.npmrc as
#   //registry.npmjs.org/:_authToken=<token>
set -uo pipefail

DRY=""; TAG="latest"; OTP=""; ASSUME_YES=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY="--dry-run" ;;
    --tag=*)   TAG="${arg#*=}" ;;
    --otp=*)   OTP="${arg#*=}" ;;
    --yes|-y)  ASSUME_YES="1" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
PKG_DIR="packages/workplane-ui"
NAME=$(node -p "require('./$PKG_DIR/package.json').name")
VERSION=$(node -p "require('./$PKG_DIR/package.json').version")

if [ -z "$DRY" ]; then
  who=$(npm whoami 2>/dev/null || true)
  [ -z "$who" ] && { echo "Not logged in to npm. Run 'npm login' first." >&2; exit 1; }
  echo "Publishing $NAME@$VERSION as $who (tag: $TAG)"
  if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
    echo "$NAME@$VERSION is already published. Bump the version first." >&2
    exit 1
  fi
  [ -z "$OTP" ] && echo "
No --otp given. This account has 2FA, so expect EOTP.
Re-run as: ./scripts/publish.sh --otp=<code from your authenticator>"
  if [ -z "$ASSUME_YES" ]; then
    echo
    read -r -p "Publishing is permanent — npm disallows unpublishing after 72 hours. Continue? [y/N] " reply
    case "$reply" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac
  fi
fi

echo "Verifying before publish..."
pnpm run build || { echo "build failed — nothing published" >&2; exit 1; }
pnpm test      || { echo "tests failed — nothing published" >&2; exit 1; }
node scripts/check-dependency-rules.mjs || { echo "boundary check failed — nothing published" >&2; exit 1; }

# Every declared entry point must actually be in the tarball. A missing
# subpath or stylesheet is invisible locally because workspace linking resolves
# from src; it is only visible in the packed artifact.
node - <<'NODE' || exit 1
const { execSync } = require("node:child_process");
const dir = "packages/workplane-ui";
const out = execSync(`cd ${dir} && npm pack --dry-run --json`, { encoding: "utf8" });
const files = new Set(JSON.parse(out)[0].files.map((f) => f.path));
const required = [
  "dist/index.js", "dist/index.d.ts",
  "dist/react.js", "dist/react.d.ts",
  "dist/echarts.js", "dist/echarts.d.ts",
  "dist/bahulam.js", "dist/bahulam.d.ts",
  "dist/testkit.js", "dist/testkit.d.ts",
  "dist/styles.css", "README.md",
];
const missing = required.filter((f) => !files.has(f));
if (missing.length) {
  console.error("Tarball is missing:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`Tarball contains all ${required.length} required paths (${files.size} files total).`);
NODE

# macOS ships bash 3.2, where expanding an empty array under `set -u` is an
# error. The `${arr[@]+...}` guard is the portable way to say "if non-empty".
OTP_ARG=(); [ -n "$OTP" ] && OTP_ARG=(--otp "$OTP")
( cd "$PKG_DIR" && pnpm publish --access public --tag "$TAG" --no-git-checks ${OTP_ARG[@]+"${OTP_ARG[@]}"} $DRY ) || {
  echo "Publish failed." >&2; exit 1; }

if [ -n "$DRY" ]; then
  echo "Dry run — nothing was published."
else
  echo "Published. Verify with:  npm view $NAME version"
fi

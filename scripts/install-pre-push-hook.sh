#!/usr/bin/env bash
# Install the HsiaoEye pre-push hook.
#
# Git doesn't track .git/hooks/ — every clone starts without hooks. Run
# this once after `git clone` (or after rm -rf .git/hooks/pre-push) to
# wire up local quality gates that fire before push.
#
# Why a separate install step:
#   - git checkout doesn't restore hook permissions.
#   - core.hooksPath would override hooks for OTHER repos sharing the
#     same machine.
#
# Idempotent. Backs up any existing pre-push to pre-push.bak first.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_SRC="${REPO_ROOT}/scripts/pre-push"
HOOK_DEST="${REPO_ROOT}/.git/hooks/pre-push"

if [ ! -f "$HOOK_SRC" ]; then
  echo "[install-hook] source missing: $HOOK_SRC" >&2
  exit 1
fi

if [ -e "$HOOK_DEST" ] && [ ! -L "$HOOK_DEST" ]; then
  echo "[install-hook] backing up existing $HOOK_DEST -> ${HOOK_DEST}.bak"
  mv -f "$HOOK_DEST" "${HOOK_DEST}.bak"
fi

# Use a real copy (not a symlink) for Windows-git compatibility.
cp -f "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "[install-hook] installed: $HOOK_DEST"
echo "[install-hook] bypass for emergencies: git push --no-verify"

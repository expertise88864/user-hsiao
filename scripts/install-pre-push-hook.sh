#!/usr/bin/env bash
# Repository-local configuration; shared worktrees use the same tracked hook.
set -eu
cd "$(git rev-parse --show-toplevel)"
test -f .githooks/pre-push
if [ ! -x .githooks/pre-push ]; then
  echo "Tracked pre-push hook is not executable; restore the committed 100755 mode." >&2
  exit 1
fi
test -f _delivery.py
existing="$(git config --local --get core.hooksPath || true)"
if [ -n "$existing" ] && [ "$existing" != ".githooks" ]; then
  echo "Another hooksPath is configured; integrate it explicitly, do not replace it." >&2
  exit 1
fi
default_hook="$(git rev-parse --git-path hooks/pre-push)"
if [ -f "$default_hook" ] && [ "$existing" != ".githooks" ]; then
  echo "Existing default hook needs explicit integration; nothing changed." >&2
  exit 1
fi
git config --local core.hooksPath .githooks
echo "Delivery hook installed. Candidate CI and exact-SHA promotion are mandatory."

#!/usr/bin/env bash
# Generic Claude Code hook → hue-claude notifier bridge.
#
# Usage in settings.json:
#   "command": "/abs/path/to/hue-claude/hooks/notify.sh working PreToolUse"
#
# Reads stdin (Claude Code passes hook payload as JSON) but ignores it — we
# only care about the event type passed as $1. $2 is an optional source label
# for the notifier's log.
#
# Failures are silent (exit 0): a dead notifier must never block Claude Code.
set -u

TYPE="${1:-idle}"
SOURCE="${2:-hook}"
PORT="${HUE_CLAUDE_PORT:-7878}"

# Discard any stdin so we never block on a pipe.
[ -t 0 ] || cat >/dev/null 2>&1 || true

curl -s --max-time 1 -X POST \
  "http://127.0.0.1:${PORT}/event?type=${TYPE}&source=${SOURCE}" \
  >/dev/null 2>&1 || true

exit 0

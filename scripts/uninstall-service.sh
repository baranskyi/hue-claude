#!/usr/bin/env bash
set -euo pipefail

PLIST_DST="${HOME}/Library/LaunchAgents/com.hue-claude.plist"
LABEL="com.hue-claude"
DOMAIN="gui/$(id -u)"

if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  echo "→ Stopping service"
  launchctl bootout "${DOMAIN}/${LABEL}" || true
fi

if [ -f "${PLIST_DST}" ]; then
  rm "${PLIST_DST}"
  echo "✓ Removed ${PLIST_DST}"
else
  echo "(plist already absent)"
fi

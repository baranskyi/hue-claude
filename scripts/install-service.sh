#!/usr/bin/env bash
# Installs hue-claude as a macOS LaunchAgent so it starts at login.
#
# Idempotent: safe to re-run after rebuilds. It will:
#   1. Build the binary if missing.
#   2. Stop the running service if loaded.
#   3. Copy the plist into ~/Library/LaunchAgents/.
#   4. Load it (kickstart so it starts immediately).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_TEMPLATE="${PROJECT_DIR}/com.hue-claude.plist.template"
PLIST_DST="${HOME}/Library/LaunchAgents/com.hue-claude.plist"
BINARY="${PROJECT_DIR}/dist/hue-claude"
LABEL="com.hue-claude"
DOMAIN="gui/$(id -u)"

if [ ! -x "${BINARY}" ]; then
  echo "→ Binary missing, building..."
  cd "${PROJECT_DIR}" && bun run build
fi

if [ ! -f "${PROJECT_DIR}/.env" ]; then
  echo "✗ .env not found in ${PROJECT_DIR}. Run discover/pair first."
  exit 1
fi

# Stop existing service if loaded (don't fail if it isn't).
if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  echo "→ Stopping existing service"
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  sleep 1
fi

mkdir -p "${HOME}/Library/LaunchAgents"
# Substitute project path into the plist template.
sed "s|__PROJECT_DIR__|${PROJECT_DIR}|g" "${PLIST_TEMPLATE}" > "${PLIST_DST}"

echo "→ Loading LaunchAgent"
launchctl bootstrap "${DOMAIN}" "${PLIST_DST}"
launchctl kickstart -k "${DOMAIN}/${LABEL}"

sleep 2

if launchctl print "${DOMAIN}/${LABEL}" 2>/dev/null | grep -q 'state = running'; then
  echo "✓ Service running"
else
  echo "⚠ Service not running. Logs:"
  echo "    /tmp/hue-claude.log"
  echo "    /tmp/hue-claude.err.log"
fi

if curl -sf --max-time 2 http://127.0.0.1:7878/health >/dev/null; then
  echo "✓ Health check OK on http://127.0.0.1:7878"
else
  echo "⚠ Health check failed. Tail /tmp/hue-claude.err.log"
fi

echo
echo "Manage with:"
echo "  launchctl print  ${DOMAIN}/${LABEL}      # status"
echo "  launchctl kickstart -k ${DOMAIN}/${LABEL} # restart"
echo "  ${PROJECT_DIR}/scripts/uninstall-service.sh"

#!/usr/bin/env bash
# Installs hue-claude hooks into ~/.claude/settings.json (global, all projects).
#
# Idempotent: merges into existing `hooks` keys without clobbering. Uses jq.
# Backs up the previous settings.json with a timestamp suffix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify.sh"
SETTINGS="${HOME}/.claude/settings.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "✗ jq is required. Install: brew install jq"
  exit 1
fi

chmod +x "${NOTIFY}"

if [ ! -f "${SETTINGS}" ]; then
  echo "{}" > "${SETTINGS}"
fi

cp "${SETTINGS}" "${SETTINGS}.bak.$(date +%Y%m%d-%H%M%S)"

# Build the hooks fragment. Each entry uses `matcher: ""` (match all) where
# applicable. PreToolUse/PostToolUse fire on every tool, so debouncing in the
# server is what keeps the light from flickering.
TMP="$(mktemp)"
jq --arg cmd "${NOTIFY}" '
  .hooks = (.hooks // {}) |
  .hooks.SessionStart   = [{ "matcher": "startup|resume", "hooks": [{ "type": "command", "command": ($cmd + " idle SessionStart") }] }] |
  .hooks.UserPromptSubmit = [{ "hooks": [{ "type": "command", "command": ($cmd + " working UserPromptSubmit") }] }] |
  .hooks.PreToolUse     = [{ "hooks": [{ "type": "command", "command": ($cmd + " working PreToolUse") }] }] |
  .hooks.Notification   = [{ "hooks": [{ "type": "command", "command": ($cmd + " waiting Notification") }] }] |
  .hooks.Stop           = [{ "hooks": [{ "type": "command", "command": ($cmd + " done Stop"), "async": true }] }] |
  .hooks.SessionEnd     = [{ "hooks": [{ "type": "command", "command": ($cmd + " idle SessionEnd") }] }]
' "${SETTINGS}" > "${TMP}"
mv "${TMP}" "${SETTINGS}"

echo "✓ Installed hooks into ${SETTINGS}"
echo "  Backup written next to it."
echo
echo "Next: start the notifier server:"
echo "  cd ${SCRIPT_DIR%/hooks} && bun run server"
echo
echo "Then open Claude Code (CLI or Mac app) — light should turn blue (idle)."

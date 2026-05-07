#!/usr/bin/env bash
# Removes hue-claude hooks from ~/.claude/settings.json.
set -euo pipefail

SETTINGS="${HOME}/.claude/settings.json"
if [ ! -f "${SETTINGS}" ]; then
  echo "no settings.json found, nothing to do"
  exit 0
fi

cp "${SETTINGS}" "${SETTINGS}.bak.$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp)"
jq '
  if .hooks then
    .hooks |= (
      to_entries
      | map(.value |= (map(select(
          (.hooks // [])
          | map(.command // "")
          | map(test("hue-claude"))
          | any | not
        ))))
      | map(select((.value | length) > 0))
      | from_entries
    )
  else . end
' "${SETTINGS}" > "${TMP}"
mv "${TMP}" "${SETTINGS}"
echo "✓ Removed hue-claude entries from ${SETTINGS}"

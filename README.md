# hue-claude

A Philips Hue lamp as a status indicator for Claude Code (CLI and Mac app).

| Color | Event | Claude Code hook |
|---|---|---|
| 🔵 Blue | idle / ready | `SessionStart`, `SessionEnd`, fade-back after `Stop` |
| 🟡 Yellow | working | `UserPromptSubmit`, `PreToolUse` |
| 🟠 Orange (breathing) | needs attention | `Notification` (permission prompt, etc.) |
| 🟢 Green | done | `Stop` (then auto-fades to blue after 8s) |

Pure local LAN — no cloud, nothing leaves your network.

## Architecture

```
Claude Code (CLI or Mac app)
        │
        │  hooks: notify.sh <type> <source>
        ▼
  curl localhost:7878/event?type=working
        │
        ▼
  Bun HTTP server (debounce + state machine)
        │
        │  PUT https://<bridge>/api/<user>/lights/<id>/state
        ▼
  Philips Hue Bridge → lamp
```

The local server exists to debounce rapid `PreToolUse`/`PostToolUse` bursts and
to fade the lamp back to blue 8s after `Stop` (so the wall isn't permanently
green).

## Prerequisites

- macOS (uses `dns-sd` for mDNS discovery)
- [Bun](https://bun.sh) ≥ 1.2
- `jq` (`brew install jq`) for the install script
- A Philips Hue Bridge on the same LAN as your Mac
- Physical access to the bridge (you press the link button to pair)

## Setup

```bash
cd ~/Personal-Super-Agent/Projects/hue-claude

# 1. Find the bridge on your LAN
bun run discover

# 2. Press the round link button on top of your Hue Bridge, then:
bun run pair          # writes HUE_BRIDGE_IP and HUE_USERNAME to .env

# 3. List lights, pick one, edit .env to set HUE_LIGHT_ID
bun run lights

# 4. Sanity-check: cycle through all four colors
bun run test-color

# 5. Start the notifier server (keep this running)
bun run server

# 6. In a SEPARATE shell: install the global Claude Code hooks
./hooks/install.sh
```

Open Claude Code (CLI or Mac app) — the lamp should turn blue immediately.

## Run the server on login (optional)

```bash
cp com.hue-claude.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.hue-claude.plist
# Logs: tail -f /tmp/hue-claude.log
```

## Customizing colors

Edit `server/hue.ts` → `COLOR_PRESETS`. Hue values use the Hue v1 API
convention:

- `hue`: 0..65535 (0 = red, 12750 ≈ yellow, 25500 ≈ green, 46920 ≈ blue)
- `sat`: 0..254
- `bri`: 1..254
- `transitiontime`: 1/10 of a second (e.g. 4 = 400ms fade)
- `alert`: `"lselect"` for ~15s breathing pulse

After editing, restart the server (`Ctrl-C` and `bun run server` again).

## Uninstall

```bash
./hooks/uninstall.sh                  # remove from ~/.claude/settings.json
launchctl unload ~/Library/LaunchAgents/com.hue-claude.plist  # if installed
```

## Troubleshooting

- **`bun run discover` finds nothing** — check that your Mac is on the same
  Wi-Fi/wired LAN as the bridge, and that no VPN is routing all traffic. mDNS
  must be allowed on that interface.
- **`No route to host` to the bridge IP** — VPN is hijacking the route. Add an
  exception for `192.168.0.0/24` (or your LAN subnet) or temporarily disconnect.
- **Light doesn't change** — `curl http://127.0.0.1:7878/health` to check the
  server. Then `curl -X POST http://127.0.0.1:7878/event?type=working` to
  trigger manually.
- **Light flickers between colors** — increase `DEBOUNCE_MS` in `.env` (try
  300–500).
- **Light stays green forever after Claude finishes** — the `Stop` hook's idle
  fade timer was cancelled by another event. Increase `IDLE_AFTER_DONE_MS` or
  inspect server logs.

## Hooks reference

The `hooks/install.sh` script writes these into `~/.claude/settings.json`:

| Hook | Why this hook | Color |
|---|---|---|
| `SessionStart` (`startup\|resume`) | session ready | idle |
| `UserPromptSubmit` | user just sent a prompt | working |
| `PreToolUse` | Claude is about to run a tool | working |
| `Notification` | Claude needs user input (permission etc.) | waiting |
| `Stop` | turn finished | done → fades to idle |
| `SessionEnd` | session terminated | idle |

Hooks work identically in the CLI and the Mac app — they read the same
`~/.claude/settings.json`.

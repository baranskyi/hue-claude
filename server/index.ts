/**
 * Local HTTP notifier server.
 *
 * Receives events from Claude Code hooks and translates them into Hue light
 * state changes, with debouncing and an idle-fallback after `done`.
 *
 * Endpoints:
 *   GET  /health           → 200 ok
 *   POST /event            → body: {"type":"idle"|"working"|"waiting"|"done", "source"?:string}
 *   POST /event?type=...   → query-string variant (used by curl in shell hooks)
 *
 * State machine (per event):
 *   working  → cancel pending idle, set yellow immediately (debounced)
 *   waiting  → set orange + breathing alert (overrides working)
 *   done     → set green, schedule fade-back to idle (blue) after IDLE_AFTER_DONE_MS
 *   idle     → set blue immediately
 *
 * Design choices:
 *   - Single-flight: only the latest desired state is applied; rapid PreToolUse/
 *     PostToolUse spam collapses into one PUT.
 *   - "done" is treated as a transient state; the timer demotes it to idle so
 *     the wall doesn't stay green forever.
 */

import { loadConfig } from "./config";
import { setLightState, COLOR_PRESETS, type EventType } from "./hue";

const cfg = loadConfig();

let pendingType: EventType | null = null;
let applyTimer: Timer | null = null;
let idleTimer: Timer | null = null;
let lastApplied: EventType | null = null;

function logEvent(type: EventType, source?: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${type.padEnd(8)} ← ${source ?? "?"}`);
}

async function applyNow(type: EventType) {
  pendingType = null;
  applyTimer = null;
  try {
    await setLightState(cfg, COLOR_PRESETS[type]);
    lastApplied = type;
  } catch (e) {
    console.error(`✗ failed to set ${type}:`, e instanceof Error ? e.message : e);
  }
}

function schedule(type: EventType) {
  pendingType = type;
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => {
    if (pendingType) void applyNow(pendingType);
  }, cfg.debounceMs);
}

function handle(type: EventType, source?: string) {
  logEvent(type, source);

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (type === "done") {
    schedule("done");
    idleTimer = setTimeout(() => {
      idleTimer = null;
      schedule("idle");
    }, cfg.idleAfterDoneMs);
    return;
  }

  schedule(type);
}

const validTypes: EventType[] = ["idle", "working", "waiting", "done"];

const server = Bun.serve({
  port: cfg.port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(`ok bridge=${cfg.bridgeIp} light=${cfg.lightId}\n`);
    }

    if (url.pathname === "/event" && req.method === "POST") {
      let type: string | null = url.searchParams.get("type");
      let source: string | null = url.searchParams.get("source");
      if (!type && req.headers.get("content-type")?.includes("json")) {
        try {
          const body = (await req.json()) as { type?: string; source?: string };
          type = body.type ?? null;
          source = body.source ?? source;
        } catch {
          /* empty body ok */
        }
      }
      if (!type || !validTypes.includes(type as EventType)) {
        return new Response(`bad type. expected one of ${validTypes.join("|")}\n`, { status: 400 });
      }
      handle(type as EventType, source ?? undefined);
      return new Response("ok\n");
    }

    return new Response("not found\n", { status: 404 });
  },
});

console.log(`hue-claude notifier listening on http://127.0.0.1:${server.port}`);
console.log(`  bridge: ${cfg.bridgeIp}  light: ${cfg.lightId}`);
console.log(`  debounce: ${cfg.debounceMs}ms  idle-after-done: ${cfg.idleAfterDoneMs}ms`);

// Set initial state
void applyNow("idle");

const shutdown = async () => {
  console.log("\n→ shutting down, fading light to idle");
  await applyNow("idle").catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

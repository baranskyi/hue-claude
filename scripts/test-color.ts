#!/usr/bin/env bun
/**
 * Cycles through all four notifier colors so you can verify the light
 * is correctly configured before wiring up Claude Code hooks.
 */

import { setLightState, type EventType, COLOR_PRESETS } from "../server/hue";
import { loadConfig } from "../server/config";

async function main() {
  const cfg = loadConfig();
  const order: EventType[] = ["idle", "working", "waiting", "done"];
  for (const type of order) {
    const preset = COLOR_PRESETS[type];
    console.log(`→ ${type.padEnd(8)} ${preset.label}`);
    await setLightState(cfg, preset);
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log("→ resetting to idle");
  await setLightState(cfg, COLOR_PRESETS.idle);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

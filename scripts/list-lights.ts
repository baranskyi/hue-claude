#!/usr/bin/env bun
/**
 * Lists all lights on the bridge so the user can pick one for HUE_LIGHT_ID.
 * Uses v2 CLIP API for richer info (name, color capability), falls back to v1.
 */

import { existsSync } from "node:fs";

async function loadEnv(): Promise<Record<string, string>> {
  const file = `${import.meta.dir}/../.env`;
  if (!existsSync(file)) {
    console.error("✗ No .env. Run `bun run discover` then `bun run pair` first.");
    process.exit(1);
  }
  const text = await Bun.file(file).text();
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const env = await loadEnv();
  const ip = env.HUE_BRIDGE_IP;
  const user = env.HUE_USERNAME;
  if (!ip || !user) {
    console.error("✗ Missing HUE_BRIDGE_IP or HUE_USERNAME in .env. Run pair first.");
    process.exit(1);
  }

  // v2 API
  const res = await fetch(`https://${ip}/clip/v2/resource/light`, {
    headers: { "hue-application-key": user },
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(5000),
  } as any);
  if (!res.ok) {
    console.error(`✗ v2 API returned ${res.status}. Falling back to v1.`);
    const v1 = await fetch(`https://${ip}/api/${user}/lights`, {
      tls: { rejectUnauthorized: false },
    } as any);
    const lights = (await v1.json()) as Record<string, { name: string; type: string; state: { on: boolean } }>;
    console.log("Lights (v1 IDs — use these for HUE_LIGHT_ID):");
    for (const [id, l] of Object.entries(lights)) {
      console.log(`  ${id.padStart(3)}  "${l.name}"  (${l.type})  on=${l.state.on}`);
    }
    return;
  }
  const json = (await res.json()) as {
    data: Array<{
      id: string;
      id_v1?: string;
      metadata?: { name: string };
      on?: { on: boolean };
      color?: unknown;
      color_temperature?: unknown;
    }>;
  };

  console.log("Lights (showing v1 ID — use that for HUE_LIGHT_ID; v2 UUID also shown):\n");
  for (const l of json.data) {
    const v1 = l.id_v1?.replace("/lights/", "") ?? "?";
    const name = l.metadata?.name ?? "(unnamed)";
    const on = l.on?.on ? "ON" : "off";
    const caps: string[] = [];
    if (l.color) caps.push("color");
    if (l.color_temperature) caps.push("ct");
    console.log(`  v1=${v1.padStart(3)}  ${name.padEnd(28)}  [${on}]  ${caps.join(",")}`);
    console.log(`        v2=${l.id}`);
  }
  console.log("\nNext: edit .env and set HUE_LIGHT_ID=<v1 id from above>");
  console.log("Then: `bun run test-color` to verify, or `bun run server` to start.");
}

main();

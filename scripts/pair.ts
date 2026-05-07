#!/usr/bin/env bun
/**
 * Pairs with a Hue Bridge by creating an application key (the v1 "username").
 *
 * USER ACTION: press the round link button on top of the bridge,
 * then this script has 30s to register. We poll every 2s.
 *
 * On success, writes HUE_USERNAME (= clientkey username) to ./.env
 *
 * v2 API also returns `clientkey` for entertainment streaming, but for
 * basic light control we only need the v1-style username, which works
 * for both /api/<user>/lights/<id>/state (v1) and as `hue-application-key`
 * header for /clip/v2 (v2).
 */

import { existsSync } from "node:fs";

const APP_NAME = "hue-claude";
const DEVICE_NAME = `${APP_NAME}#${process.env.USER ?? "mac"}`;
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 60_000;

async function readEnv(): Promise<Record<string, string>> {
  const file = `${import.meta.dir}/../.env`;
  if (!existsSync(file)) return {};
  const text = await Bun.file(file).text();
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function writeEnv(env: Record<string, string>) {
  const file = `${import.meta.dir}/../.env`;
  const text =
    [
      `HUE_BRIDGE_IP=${env.HUE_BRIDGE_IP ?? ""}`,
      `HUE_USERNAME=${env.HUE_USERNAME ?? ""}`,
      `HUE_LIGHT_ID=${env.HUE_LIGHT_ID ?? ""}`,
      `PORT=${env.PORT ?? "7878"}`,
      `IDLE_AFTER_DONE_MS=${env.IDLE_AFTER_DONE_MS ?? "8000"}`,
      `DEBOUNCE_MS=${env.DEBOUNCE_MS ?? "150"}`,
    ].join("\n") + "\n";
  await Bun.write(file, text);
}

async function tryRegister(ip: string): Promise<{ username: string; clientkey?: string } | { error: string }> {
  const res = await fetch(`https://${ip}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devicetype: DEVICE_NAME, generateclientkey: true }),
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(5000),
  } as any);
  const data = (await res.json()) as Array<
    { success?: { username: string; clientkey?: string } } | { error?: { type: number; description: string } }
  >;
  const item = data[0];
  if ("success" in item && item.success) return item.success;
  if ("error" in item && item.error) return { error: item.error.description };
  return { error: "unexpected response" };
}

async function main() {
  const cliIp = process.argv[2];
  const env = await readEnv();
  const ip = cliIp ?? process.env.HUE_BRIDGE_IP ?? env.HUE_BRIDGE_IP;
  if (!ip) {
    console.error("✗ No bridge IP. Run `bun run discover` first, or pass IP as arg.");
    process.exit(1);
  }

  console.log(`→ Pairing with bridge at ${ip}`);
  console.log("→ PRESS the round link button on top of your Hue Bridge NOW.");
  console.log(`  Waiting up to ${TIMEOUT_MS / 1000}s...`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await tryRegister(ip).catch((e) => ({ error: String(e) }));
    if ("username" in result) {
      console.log("\n✓ Paired!");
      console.log(`  username:  ${result.username}`);
      if (result.clientkey) console.log(`  clientkey: ${result.clientkey}`);
      env.HUE_BRIDGE_IP = ip;
      env.HUE_USERNAME = result.username;
      await writeEnv(env);
      console.log(`\n→ Wrote .env. Next: \`bun run lights\` to pick a light.`);
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error("\n✗ Timed out. Did you press the link button?");
  process.exit(1);
}

main();

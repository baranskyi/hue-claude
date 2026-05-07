#!/usr/bin/env bun
/**
 * Discovers Philips Hue Bridges on the local network.
 *
 * Strategy (in order):
 *   1. mDNS browse for `_hue._tcp.local.` via macOS `dns-sd`
 *   2. Fallback: query the cloud discovery service https://discovery.meethue.com
 *
 * Verifies each candidate by hitting `https://<ip>/api/0/config`.
 */

import { spawn } from "bun";

type Bridge = { ip: string; id?: string; name?: string; swversion?: string };

async function mdnsDiscover(timeoutMs = 4000): Promise<Bridge[]> {
  if (process.platform !== "darwin") return [];

  const browse = spawn(["dns-sd", "-B", "_hue._tcp", "local."], { stdout: "pipe", stderr: "ignore" });
  const reader = browse.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const instances = new Set<string>();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (result.done) break;
    buf += decoder.decode(result.value);
    for (const line of buf.split("\n")) {
      const m = line.match(/_hue\._tcp\.\s+(Hue Bridge - [0-9A-Fa-f]+)/);
      if (m) instances.add(m[1]);
    }
    buf = buf.split("\n").slice(-1)[0];
  }
  browse.kill();

  const bridges: Bridge[] = [];
  for (const instance of instances) {
    const host = await resolveInstance(instance);
    if (!host) continue;
    const ip = await resolveHost(host);
    if (!ip) continue;
    bridges.push({ ip, name: instance });
  }
  return bridges;
}

async function resolveInstance(instance: string): Promise<string | null> {
  const proc = spawn(["dns-sd", "-L", instance, "_hue._tcp", "local."], { stdout: "pipe", stderr: "ignore" });
  const text = await readWithTimeout(proc, 2500);
  proc.kill();
  const m = text.match(/can be reached at ([\w.-]+):/);
  return m ? m[1].replace(/\.$/, "") : null;
}

async function resolveHost(host: string): Promise<string | null> {
  const proc = spawn(["dns-sd", "-G", "v4", host], { stdout: "pipe", stderr: "ignore" });
  const text = await readWithTimeout(proc, 2500);
  proc.kill();
  const m = text.match(/(\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

async function readWithTimeout(proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (result.done) break;
    buf += decoder.decode(result.value);
  }
  return buf;
}

async function cloudDiscover(): Promise<Bridge[]> {
  try {
    const res = await fetch("https://discovery.meethue.com/", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ id: string; internalipaddress: string; port?: number }>;
    return data.map((b) => ({ ip: b.internalipaddress, id: b.id }));
  } catch {
    return [];
  }
}

async function saveBridgeIp(ip: string): Promise<void> {
  const file = `${import.meta.dir}/../.env`;
  const existing = (await Bun.file(file).text().catch(() => "")) as string;
  const lines = existing.split("\n").filter((l) => l.trim() && !l.startsWith("HUE_BRIDGE_IP="));
  lines.unshift(`HUE_BRIDGE_IP=${ip}`);
  await Bun.write(file, lines.join("\n") + "\n");
}

async function probe(bridge: Bridge): Promise<Bridge | null> {
  try {
    const res = await fetch(`https://${bridge.ip}/api/0/config`, {
      tls: { rejectUnauthorized: false },
      signal: AbortSignal.timeout(5000),
    } as any);
    if (!res.ok) return null;
    const cfg = (await res.json()) as { name: string; bridgeid: string; swversion: string; modelid: string };
    return { ...bridge, id: cfg.bridgeid, name: cfg.name, swversion: cfg.swversion };
  } catch {
    return null;
  }
}

async function main() {
  console.log("→ Searching for Hue bridges (mDNS, ~4s)...");
  const mdns = await mdnsDiscover();
  console.log(`  mDNS found: ${mdns.length}`);

  let candidates = mdns;
  if (candidates.length === 0) {
    console.log("→ Falling back to cloud discovery...");
    candidates = await cloudDiscover();
    console.log(`  Cloud found: ${candidates.length}`);
  }

  if (candidates.length === 0) {
    console.error("✗ No bridges found. Check network and try again.");
    process.exit(1);
  }

  console.log("→ Verifying bridges...");
  const verified: Bridge[] = [];
  for (const c of candidates) {
    const v = await probe(c);
    if (v) verified.push(v);
  }

  if (verified.length === 0) {
    console.error("✗ Bridges seen but none responded on HTTPS. VPN routing? Firewall?");
    process.exit(1);
  }

  console.log("\n✓ Bridges:");
  for (const b of verified) {
    console.log(`    IP:      ${b.ip}`);
    console.log(`    ID:      ${b.id}`);
    console.log(`    Name:    ${b.name}`);
    if (b.swversion) console.log(`    SW ver:  ${b.swversion}`);
    console.log("");
  }

  if (verified.length === 1) {
    await saveBridgeIp(verified[0].ip);
    console.log(`✓ Saved HUE_BRIDGE_IP=${verified[0].ip} to .env`);
    console.log(`Next step: bun run pair`);
  } else {
    console.log("Next step: pick one IP, then `HUE_BRIDGE_IP=<ip> bun run pair`");
  }
}

main();

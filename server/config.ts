import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Config = {
  bridgeIp: string;
  username: string;
  lightId: string;
  port: number;
  idleAfterDoneMs: number;
  debounceMs: number;
};

function readDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function findEnvFile(): Record<string, string> {
  // Search order: HUE_CLAUDE_ENV env var → cwd → exe dir & parents → fixed install path.
  const candidates: string[] = [];
  if (process.env.HUE_CLAUDE_ENV) candidates.push(process.env.HUE_CLAUDE_ENV);
  candidates.push(join(process.cwd(), ".env"));
  let dir = dirname(process.execPath);
  for (let i = 0; i < 4; i++) {
    candidates.push(join(dir, ".env"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const path of candidates) {
    if (existsSync(path)) return readDotenv(path);
  }
  return {};
}

export function loadConfig(): Config {
  const envFile = findEnvFile();
  const get = (k: string) => process.env[k] ?? envFile[k] ?? "";

  const bridgeIp = get("HUE_BRIDGE_IP");
  const username = get("HUE_USERNAME");
  const lightId = get("HUE_LIGHT_ID");
  if (!bridgeIp || !username || !lightId) {
    throw new Error(
      "Missing config. Need HUE_BRIDGE_IP, HUE_USERNAME, HUE_LIGHT_ID. Run discover → pair → list-lights.",
    );
  }
  return {
    bridgeIp,
    username,
    lightId,
    port: Number(get("PORT") || 7878),
    idleAfterDoneMs: Number(get("IDLE_AFTER_DONE_MS") || 8000),
    debounceMs: Number(get("DEBOUNCE_MS") || 150),
  };
}

/**
 * Talks to a Philips Hue Bridge over the v1 LAN API (HTTPS, self-signed).
 *
 * v1 is used because it's stable, well-documented, accepts plain hue/sat/bri
 * values (no xy color-space math required), and v2 doesn't add anything we
 * need for a single-light notifier.
 *
 * Endpoint: PUT https://<ip>/api/<user>/lights/<id>/state
 * Body fields used:
 *   on  : boolean
 *   bri : 1..254
 *   hue : 0..65535      (0=red, ~25500=green, ~46920=blue)
 *   sat : 0..254
 *   transitiontime : 1/10 of a second
 *   alert : "select" | "lselect" | "none"
 */

import type { Config } from "./config";

export type EventType = "idle" | "working" | "waiting" | "done";

export type LightPreset = {
  label: string;
  on: boolean;
  hue?: number;
  sat?: number;
  bri?: number;
  alert?: "none" | "select" | "lselect";
  transitiontime?: number; // 1/10s
};

export const COLOR_PRESETS: Record<EventType, LightPreset> = {
  idle: {
    label: "blue (idle / ready)",
    on: true,
    hue: 46920,
    sat: 254,
    bri: 80,
    transitiontime: 8,
  },
  working: {
    label: "yellow (working)",
    on: true,
    hue: 12750,
    sat: 254,
    bri: 200,
    transitiontime: 2,
  },
  waiting: {
    label: "orange + breathe (needs attention)",
    on: true,
    hue: 5000,
    sat: 254,
    bri: 254,
    alert: "lselect", // breathing pulse for ~15s
    transitiontime: 1,
  },
  done: {
    label: "green (done)",
    on: true,
    hue: 25500,
    sat: 254,
    bri: 200,
    transitiontime: 4,
  },
};

export async function setLightState(cfg: Config, preset: LightPreset): Promise<void> {
  const body: Record<string, unknown> = { on: preset.on };
  if (preset.hue !== undefined) body.hue = preset.hue;
  if (preset.sat !== undefined) body.sat = preset.sat;
  if (preset.bri !== undefined) body.bri = preset.bri;
  if (preset.alert !== undefined) body.alert = preset.alert;
  if (preset.transitiontime !== undefined) body.transitiontime = preset.transitiontime;

  const url = `https://${cfg.bridgeIp}/api/${cfg.username}/lights/${cfg.lightId}/state`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(4000),
  } as any);

  if (!res.ok) {
    throw new Error(`Hue PUT ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as Array<{ error?: { description: string } }>;
  const err = data.find((d) => d.error)?.error;
  if (err) throw new Error(`Hue API error: ${err.description}`);
}

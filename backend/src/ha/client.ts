import { config } from "../config";
import { logger } from "../logger";
import type { HaState, HaDevice, HaArea, HaEntity } from "../types";

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${config.ha.supervisorToken}`,
  "Content-Type": "application/json",
});

async function haFetch<T>(path: string): Promise<T> {
  const base = config.isAddon
    ? "http://supervisor/core"
    : config.ha.supervisorUrl;
  const url = `${base}${path}`;

  const res = await fetch(url, { headers: headers() });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA API ${res.status} ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function getStates(): Promise<HaState[]> {
  return haFetch<HaState[]>("/api/states");
}

export async function getState(entityId: string): Promise<HaState> {
  return haFetch<HaState>(`/api/states/${encodeURIComponent(entityId)}`);
}

export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<void> {
  const base = config.isAddon
    ? "http://supervisor/core"
    : config.ha.supervisorUrl;
  const url = `${base}/api/services/${domain}/${service}`;

  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA service call ${res.status}: ${body}`);
  }
}

export async function getDeviceRegistry(): Promise<HaDevice[]> {
  const base = config.isAddon ? "http://supervisor" : config.ha.supervisorUrl;
  const url = `${base}/api/hassio/homeassistant/api/config/device_registry/list`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Device registry ${res.status}`);
    }

    const data = (await res.json()) as { result: HaDevice[] } | HaDevice[];
    return Array.isArray(data) ? data : data.result ?? [];
  } catch (err) {
    logger.warn({ err }, "Failed to fetch device registry, falling back to WS");
    return [];
  }
}

export async function getAreaRegistry(): Promise<HaArea[]> {
  const base = config.isAddon ? "http://supervisor" : config.ha.supervisorUrl;
  const url = `${base}/api/hassio/homeassistant/api/config/area_registry/list`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Area registry ${res.status}`);
    }

    const data = (await res.json()) as { result: HaArea[] } | HaArea[];
    return Array.isArray(data) ? data : data.result ?? [];
  } catch (err) {
    logger.warn({ err }, "Failed to fetch area registry");
    return [];
  }
}

export async function getEntityRegistry(): Promise<HaEntity[]> {
  const base = config.isAddon ? "http://supervisor" : config.ha.supervisorUrl;
  const url = `${base}/api/hassio/homeassistant/api/config/entity_registry/list`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Entity registry ${res.status}`);
    }

    const data = (await res.json()) as { result: HaEntity[] } | HaEntity[];
    return Array.isArray(data) ? data : data.result ?? [];
  } catch (err) {
    logger.warn({ err }, "Failed to fetch entity registry");
    return [];
  }
}

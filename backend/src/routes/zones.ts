import type { FastifyInstance } from "fastify";
import { loadJson, saveJson } from "../store";
import { getRecentEvents, getZoneStates } from "../engine";
import type { Zone, ActionStep } from "../types";
import { logger } from "../logger";

const ZONES_FILE = "zones.json";

export function loadZones(): Zone[] {
  const raw = loadJson<Zone[]>(ZONES_FILE, []);
  return raw.map((z) => ({
    ...z,
    auxiliarySensors: Array.isArray(z.auxiliarySensors) ? z.auxiliarySensors : [],
  }));
}

function saveZones(zones: Zone[]): void {
  saveJson(ZONES_FILE, zones);
}

function validateActions(arr: unknown): ActionStep[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (a: Record<string, unknown>) =>
        typeof a.entityId === "string" && typeof a.service === "string",
    )
    .map((a: Record<string, unknown>) => ({
      id: typeof a.id === "string" ? a.id : `as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityId: a.entityId as string,
      service: a.service as string,
      data: typeof a.data === "object" && a.data !== null ? (a.data as Record<string, unknown>) : undefined,
      delay: typeof a.delay === "number" ? Math.max(0, a.delay) : 0,
    }));
}

function validateZone(body: unknown): Zone | null {
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (typeof b.color !== "string") return null;
  if (!Array.isArray(b.points) || b.points.length < 3) return null;

  const points = (b.points as { x: unknown; y: unknown }[]).filter(
    (p) => typeof p.x === "number" && typeof p.y === "number",
  );
  if (points.length < 3) return null;

  return {
    id: typeof b.id === "string" ? b.id : "",
    name: (b.name as string).trim(),
    color: b.color as string,
    points: points.map((p) => ({ x: p.x as number, y: p.y as number })),
    enabled: typeof b.enabled === "boolean" ? b.enabled : true,
    dwellTime: typeof b.dwellTime === "number" ? Math.max(0, b.dwellTime) : 500,
    exitDelay: typeof b.exitDelay === "number" ? Math.max(0, b.exitDelay) : 30000,
    onEnter: validateActions(b.onEnter),
    onExit: validateActions(b.onExit),
    auxiliarySensors: Array.isArray(b.auxiliarySensors)
      ? (b.auxiliarySensors as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
  };
}

export async function zoneRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/zones", async (_req, reply) => {
    try {
      const zones = loadZones();
      const states = getZoneStates();
      const result = zones.map((z) => ({
        ...z,
        state: states.get(z.id) ?? { occupied: false, targetCount: 0 },
      }));
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, "Failed to load zones");
      return reply.status(500).send({ error: "Failed to load zones" });
    }
  });

  app.post("/api/zones", async (req, reply) => {
    try {
      const zone = validateZone(req.body);
      if (!zone) {
        return reply.status(400).send({ error: "Invalid zone data. Need name, color, and at least 3 points." });
      }
      zone.id = `z-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const zones = loadZones();
      zones.push(zone);
      saveZones(zones);
      return reply.status(201).send(zone);
    } catch (err) {
      logger.error({ err }, "Failed to create zone");
      return reply.status(500).send({ error: "Failed to create zone" });
    }
  });

  app.put<{ Params: { id: string } }>("/api/zones/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const zones = loadZones();
      const idx = zones.findIndex((z) => z.id === id);
      if (idx === -1) return reply.status(404).send({ error: "Zone not found" });

      const updated = validateZone(req.body);
      if (!updated) return reply.status(400).send({ error: "Invalid zone data" });

      updated.id = id;
      zones[idx] = updated;
      saveZones(zones);
      return reply.send(updated);
    } catch (err) {
      logger.error({ err }, "Failed to update zone");
      return reply.status(500).send({ error: "Failed to update zone" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/zones/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const zones = loadZones();
      const filtered = zones.filter((z) => z.id !== id);
      if (filtered.length === zones.length) {
        return reply.status(404).send({ error: "Zone not found" });
      }
      saveZones(filtered);
      return reply.send({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to delete zone");
      return reply.status(500).send({ error: "Failed to delete zone" });
    }
  });

  app.get("/api/zones/activity", async (_req, reply) => {
    return reply.send(getRecentEvents());
  });

  app.get("/api/zones/states", async (_req, reply) => {
    const states = getZoneStates();
    return reply.send(Object.fromEntries(states));
  });
}

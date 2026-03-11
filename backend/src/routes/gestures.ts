import type { FastifyInstance } from "fastify";
import { loadJson, saveJson } from "../store";
import { getRecentGestureEvents } from "../engine";
import type { GestureBinding } from "../types";
import { logger } from "../logger";

const GESTURES_FILE = "gestures.json";

export function loadGestures(): GestureBinding[] {
  return loadJson<GestureBinding[]>(GESTURES_FILE, []);
}

function saveGestures(bindings: GestureBinding[]): void {
  saveJson(GESTURES_FILE, bindings);
}

export async function gestureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/gestures", async (_req, reply) => {
    try {
      return reply.send(loadGestures());
    } catch (err) {
      logger.error({ err }, "Failed to load gestures");
      return reply.status(500).send({ error: "Failed to load gestures" });
    }
  });

  app.post("/api/gestures", async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (typeof b.name !== "string" || !b.name.trim()) {
        return reply.status(400).send({ error: "Gesture name is required" });
      }
      if (typeof b.gesture !== "string") {
        return reply.status(400).send({ error: "Gesture type is required" });
      }

      const binding: GestureBinding = {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: (b.name as string).trim(),
        gesture: b.gesture as GestureBinding["gesture"],
        enabled: b.enabled !== false,
        sensitivity: typeof b.sensitivity === "number" ? Math.max(0.1, Math.min(3, b.sensitivity)) : 1,
        cooldown: typeof b.cooldown === "number" ? Math.max(0, b.cooldown) : 2000,
        zoneId: typeof b.zoneId === "string" ? b.zoneId : null,
        actions: Array.isArray(b.actions) ? b.actions as GestureBinding["actions"] : [],
      };

      const bindings = loadGestures();
      bindings.push(binding);
      saveGestures(bindings);
      return reply.status(201).send(binding);
    } catch (err) {
      logger.error({ err }, "Failed to create gesture binding");
      return reply.status(500).send({ error: "Failed to create gesture binding" });
    }
  });

  app.put<{ Params: { id: string } }>("/api/gestures/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const bindings = loadGestures();
      const idx = bindings.findIndex((g) => g.id === id);
      if (idx === -1) return reply.status(404).send({ error: "Gesture binding not found" });

      const b = req.body as Record<string, unknown>;
      const existing = bindings[idx];
      bindings[idx] = {
        ...existing,
        name: typeof b.name === "string" ? b.name.trim() : existing.name,
        gesture: typeof b.gesture === "string" ? b.gesture as GestureBinding["gesture"] : existing.gesture,
        enabled: typeof b.enabled === "boolean" ? b.enabled : existing.enabled,
        sensitivity: typeof b.sensitivity === "number" ? Math.max(0.1, Math.min(3, b.sensitivity)) : existing.sensitivity,
        cooldown: typeof b.cooldown === "number" ? Math.max(0, b.cooldown) : existing.cooldown,
        zoneId: b.zoneId === null || typeof b.zoneId === "string" ? b.zoneId as string | null : existing.zoneId,
        actions: Array.isArray(b.actions) ? b.actions as GestureBinding["actions"] : existing.actions,
      };

      saveGestures(bindings);
      return reply.send(bindings[idx]);
    } catch (err) {
      logger.error({ err }, "Failed to update gesture binding");
      return reply.status(500).send({ error: "Failed to update gesture binding" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/gestures/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const bindings = loadGestures();
      const idx = bindings.findIndex((g) => g.id === id);
      if (idx === -1) return reply.status(404).send({ error: "Gesture binding not found" });
      bindings.splice(idx, 1);
      saveGestures(bindings);
      return reply.send({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to delete gesture binding");
      return reply.status(500).send({ error: "Failed to delete gesture binding" });
    }
  });

  app.get("/api/gestures/activity", async (_req, reply) => {
    try {
      return reply.send(getRecentGestureEvents());
    } catch (err) {
      logger.error({ err }, "Failed to load gesture activity");
      return reply.status(500).send({ error: "Failed to load gesture activity" });
    }
  });

  app.post("/api/gestures/feedback", async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (typeof b.bindingId !== "string" || typeof b.correct !== "boolean") {
        return reply.status(400).send({ error: "bindingId and correct (boolean) are required" });
      }
      const bindings = loadGestures();
      const idx = bindings.findIndex((g) => g.id === (b.bindingId as string));
      if (idx === -1) return reply.status(404).send({ error: "Binding not found" });
      const stats = bindings[idx].stats ?? { correct: 0, incorrect: 0 };
      if (b.correct) stats.correct++;
      else stats.incorrect++;
      bindings[idx] = { ...bindings[idx], stats };
      saveGestures(bindings);
      return reply.send({ ok: true, stats });
    } catch (err) {
      logger.error({ err }, "Failed to save gesture feedback");
      return reply.status(500).send({ error: "Failed to save feedback" });
    }
  });
}

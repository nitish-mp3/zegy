import type { FastifyInstance } from "fastify";
import { getStates } from "../ha/client";
import type { SensorReading } from "../types";
import { logger } from "../logger";

const SENSOR_DOMAINS = new Set(["sensor", "binary_sensor"]);

export async function sensorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sensors", async (_req, reply) => {
    try {
      const states = await getStates();

      const sensors: SensorReading[] = states
        .filter((s) => {
          const domain = s.entity_id.split(".")[0];
          return SENSOR_DOMAINS.has(domain);
        })
        .map((s) => ({
          entityId: s.entity_id,
          value: s.state,
          unit: (s.attributes.unit_of_measurement as string) ?? "",
          timestamp: s.last_updated,
          deviceClass: (s.attributes.device_class as string) ?? null,
        }));

      return reply.send(sensors);
    } catch (err) {
      logger.error({ err }, "Failed to fetch sensors");
      return reply.status(502).send({ error: "Failed to reach Home Assistant" });
    }
  });

  app.get("/api/sensors/summary", async (_req, reply) => {
    try {
      const states = await getStates();

      const byClass = new Map<string, number>();
      let total = 0;
      let unavailable = 0;

      for (const s of states) {
        const domain = s.entity_id.split(".")[0];
        if (!SENSOR_DOMAINS.has(domain)) continue;

        total++;
        if (s.state === "unavailable" || s.state === "unknown") {
          unavailable++;
        }

        const cls = (s.attributes.device_class as string) ?? "other";
        byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
      }

      return reply.send({
        total,
        available: total - unavailable,
        unavailable,
        byClass: Object.fromEntries(byClass),
      });
    } catch (err) {
      logger.error({ err }, "Failed to compute sensor summary");
      return reply.status(502).send({ error: "Failed to reach Home Assistant" });
    }
  });
}

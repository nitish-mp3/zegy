import type { FastifyInstance } from "fastify";
import {
  getStates,
  getDeviceRegistry,
  getAreaRegistry,
  getEntityRegistry,
} from "../ha/client";
import type { DeviceSummary, SensorReading } from "../types";
import { logger } from "../logger";

const SENSOR_DOMAINS = new Set([
  "sensor",
  "binary_sensor",
  "climate",
  "weather",
  "light",
  "switch",
  "fan",
  "cover",
]);

function isSensorEntity(entityId: string): boolean {
  const domain = entityId.split(".")[0];
  return SENSOR_DOMAINS.has(domain);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/devices", async (_req, reply) => {
    try {
      const [states, devices, areas, entities] = await Promise.all([
        getStates(),
        getDeviceRegistry(),
        getAreaRegistry(),
        getEntityRegistry(),
      ]);

      const areaMap = new Map(areas.map((a) => [a.area_id, a.name]));
      const entityByEntityId = new Map(entities.map((e) => [e.entity_id, e]));

      const deviceSensors = new Map<string, SensorReading[]>();

      for (const state of states) {
        if (!isSensorEntity(state.entity_id)) continue;

        const entityReg = entityByEntityId.get(state.entity_id);
        const deviceId = entityReg?.device_id;
        if (!deviceId) continue;

        const reading: SensorReading = {
          entityId: state.entity_id,
          value: state.state,
          unit: (state.attributes.unit_of_measurement as string) ?? "",
          timestamp: state.last_updated,
          deviceClass: (state.attributes.device_class as string) ?? null,
        };

        const existing = deviceSensors.get(deviceId) ?? [];
        existing.push(reading);
        deviceSensors.set(deviceId, existing);
      }

      const result: DeviceSummary[] = devices
        .filter((d) => deviceSensors.has(d.id))
        .map((d) => ({
          id: d.id,
          name: d.name ?? "Unknown",
          manufacturer: d.manufacturer ?? "",
          model: d.model ?? "",
          area: d.area_id ? (areaMap.get(d.area_id) ?? null) : null,
          firmware: d.sw_version ?? null,
          sensors: deviceSensors.get(d.id) ?? [],
          online: true,
        }));

      return reply.send(result);
    } catch (err) {
      logger.error({ err }, "Failed to fetch devices");
      return reply.status(502).send({ error: "Failed to reach Home Assistant" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const [states, devices, areas, entities] = await Promise.all([
        getStates(),
        getDeviceRegistry(),
        getAreaRegistry(),
        getEntityRegistry(),
      ]);

      const device = devices.find((d) => d.id === id);
      if (!device) {
        return reply.status(404).send({ error: "Device not found" });
      }

      const areaMap = new Map(areas.map((a) => [a.area_id, a.name]));
      const deviceEntities = entities.filter((e) => e.device_id === id);
      const entityIds = new Set(deviceEntities.map((e) => e.entity_id));

      const sensors: SensorReading[] = states
        .filter((s) => entityIds.has(s.entity_id) && isSensorEntity(s.entity_id))
        .map((s) => ({
          entityId: s.entity_id,
          value: s.state,
          unit: (s.attributes.unit_of_measurement as string) ?? "",
          timestamp: s.last_updated,
          deviceClass: (s.attributes.device_class as string) ?? null,
        }));

      const summary: DeviceSummary = {
        id: device.id,
        name: device.name ?? "Unknown",
        manufacturer: device.manufacturer ?? "",
        model: device.model ?? "",
        area: device.area_id ? (areaMap.get(device.area_id) ?? null) : null,
        firmware: device.sw_version ?? null,
        sensors,
        online: true,
      };

      return reply.send(summary);
    } catch (err) {
      logger.error({ err }, "Failed to fetch device detail");
      return reply.status(502).send({ error: "Failed to reach Home Assistant" });
    }
  });
}

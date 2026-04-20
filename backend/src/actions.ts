import { callService } from "./ha/client";
import { mqttPublish } from "./mqtt/client";
import { logger } from "./logger";
import type { ActionStep } from "./types";

export async function executeActions(actions: ActionStep[]): Promise<void> {
  for (const action of actions) {
    if (action.delay > 0) {
      await new Promise<void>((r) => setTimeout(r, action.delay));
    }
    const type = action.type ?? "ha_service";
    try {
      if (type === "ha_service") {
        const a = action as Extract<ActionStep, { type?: "ha_service" }>;
        if (!a.entityId || !a.service) {
          logger.warn({ entityId: a.entityId, service: a.service }, "Skipping ha_service action: missing entityId or service");
        } else {
          const domain = a.entityId.split(".")[0];
          await callService(domain, a.service, { entity_id: a.entityId, ...a.data });
          logger.info({ entityId: a.entityId, service: a.service }, "Action executed: ha_service");
        }
      } else if (type === "mqtt_publish") {
        const a = action as Extract<ActionStep, { type: "mqtt_publish" }>;
        mqttPublish(a.topic, a.payload);
        logger.info({ topic: a.topic }, "Action executed: mqtt_publish");
      } else if (type === "webhook") {
        const a = action as Extract<ActionStep, { type: "webhook" }>;
        const init: RequestInit = { method: a.method ?? "POST" };
        if (a.headers) init.headers = a.headers;
        if (a.body !== undefined) init.body = a.body;
        await fetch(a.url, init);
        logger.info({ url: a.url, method: a.method }, "Action executed: webhook");
      }
    } catch (err) {
      logger.error({ err, type }, "Failed to execute action");
    }
  }
}

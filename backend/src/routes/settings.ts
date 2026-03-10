import type { FastifyInstance } from "fastify";
import { loadJson, saveJson } from "../store";
import { logger } from "../logger";

const SETTINGS_FILE = "settings.json";

interface MqttSettings {
  mqttUrl: string;
  mqttUsername: string;
  /** Password stored but never returned to client in GET responses */
  mqttPassword: string;
}

function loadSettings(): MqttSettings {
  return loadJson<MqttSettings>(SETTINGS_FILE, {
    mqttUrl: "",
    mqttUsername: "",
    mqttPassword: "",
  });
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings  — returns current settings (password field omitted)
  app.get("/api/settings", async (_req, reply) => {
    try {
      const s = loadSettings();
      return reply.send({
        mqttUrl: s.mqttUrl,
        mqttUsername: s.mqttUsername,
        mqttPasswordSet: s.mqttPassword.length > 0,
      });
    } catch (err) {
      logger.error({ err }, "Failed to load settings");
      return reply.status(500).send({ error: "Failed to load settings" });
    }
  });

  // PUT /api/settings  — update MQTT settings
  app.put("/api/settings", async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;

      const current = loadSettings();

      const next: MqttSettings = {
        mqttUrl: typeof b.mqttUrl === "string" ? b.mqttUrl.trim() : current.mqttUrl,
        mqttUsername: typeof b.mqttUsername === "string" ? b.mqttUsername.trim() : current.mqttUsername,
        // Only update password if explicitly provided (non-empty string)
        mqttPassword:
          typeof b.mqttPassword === "string" && b.mqttPassword.length > 0
            ? b.mqttPassword
            : current.mqttPassword,
      };

      saveJson(SETTINGS_FILE, next);
      logger.info({ url: next.mqttUrl }, "Settings updated");

      return reply.send({
        mqttUrl: next.mqttUrl,
        mqttUsername: next.mqttUsername,
        mqttPasswordSet: next.mqttPassword.length > 0,
      });
    } catch (err) {
      logger.error({ err }, "Failed to save settings");
      return reply.status(500).send({ error: "Failed to save settings" });
    }
  });
}

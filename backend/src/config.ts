import fs from "node:fs";
import { logger } from "./logger";

interface AppConfig {
  port: number;
  host: string;
  frontendDist: string;
  ha: {
    supervisorUrl: string;
    supervisorToken: string;
    websocketUrl: string;
  };
  mqtt: {
    url: string;
    username: string;
    password: string;
  };
  isAddon: boolean;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function firstNonEmpty(...values: (unknown)[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function resolveConfig(): AppConfig {
  const supervisorToken = process.env.SUPERVISOR_TOKEN ?? "";
  const isAddon = !!supervisorToken;

  const haUrl = process.env.HA_URL ?? "http://supervisor/core";
  const supervisorUrl = isAddon ? "http://supervisor" : haUrl;

  const wsBase = supervisorUrl.replace(/^http/, "ws");

  // MQTT config priority: env vars → addon options → saved settings
  const addonOpts = readJsonFile("/data/options.json");
  const savedSettings = readJsonFile("/config/zegy/settings.json");

  return {
    port: parseInt(process.env.PORT ?? "47200", 10),
    host: "0.0.0.0",
    frontendDist: process.env.FRONTEND_DIST ?? "../frontend/dist",
    ha: {
      supervisorUrl,
      supervisorToken: isAddon ? supervisorToken : (process.env.HA_TOKEN ?? ""),
      websocketUrl: isAddon
        ? `${wsBase}/core/websocket`
        : `${wsBase}/api/websocket`,
    },
    mqtt: {
      url: firstNonEmpty(
        process.env.MQTT_URL,
        addonOpts.mqtt_url,
        savedSettings.mqttUrl,
      ),
      username: firstNonEmpty(
        process.env.MQTT_USERNAME,
        addonOpts.mqtt_username,
        savedSettings.mqttUsername,
      ),
      password: firstNonEmpty(
        process.env.MQTT_PASSWORD,
        addonOpts.mqtt_password,
        savedSettings.mqttPassword,
      ),
    },
    isAddon,
  };
}

export const config = resolveConfig();

if (!config.ha.supervisorToken) {
  logger.warn(
    "No SUPERVISOR_TOKEN or HA_TOKEN found. Home Assistant API calls will fail.",
  );
}

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

function resolveConfig(): AppConfig {
  const supervisorToken = process.env.SUPERVISOR_TOKEN ?? "";
  const isAddon = !!supervisorToken;

  const haUrl = process.env.HA_URL ?? "http://supervisor/core";
  const supervisorUrl = isAddon ? "http://supervisor" : haUrl;

  const wsBase = supervisorUrl.replace(/^http/, "ws");

  return {
    port: parseInt(process.env.PORT ?? "47200", 10),
    host: "0.0.0.0",
    frontendDist: process.env.FRONTEND_DIST ?? "../frontend/dist",
    ha: {
      supervisorUrl,
      supervisorToken: isAddon ? supervisorToken : (process.env.HA_TOKEN ?? ""),
      websocketUrl: `${wsBase}/api/websocket`,
    },
    mqtt: {
      url: process.env.MQTT_URL ?? "",
      username: process.env.MQTT_USERNAME ?? "",
      password: process.env.MQTT_PASSWORD ?? "",
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

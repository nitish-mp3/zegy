import { config } from "./config";
import { logger } from "./logger";
import { createServer } from "./server";
import { startHaWebSocket, stopHaWebSocket } from "./ha";
import { startMqtt, stopMqtt, onTrackFrame, setNodeResolver, setAutoCreateNode } from "./mqtt";
import { processTrackFrame, onZoneEvent, processGestureFrame, onGestureEvent, onGestureDebug, initPresenceFusion } from "./engine";
import { broadcastEvent } from "./ws";
import { loadZones } from "./routes/zones";
import { loadNodes, autoCreateNodeEntry } from "./routes/nodes";
import { loadGestures } from "./routes/gestures";
import { startBackgroundCameraGestures, stopBackgroundCameraGestures } from "./camera/background";

async function discoverMqttFromSupervisor(): Promise<void> {
  if (config.mqtt.url || !config.isAddon) return;
  try {
    const resp = await fetch("http://supervisor/services/mqtt", {
      headers: { Authorization: `Bearer ${config.ha.supervisorToken}` },
    });
    if (!resp.ok) return;
    const json = (await resp.json()) as {
      data?: { host?: string; port?: number; username?: string; password?: string };
    };
    const mqtt = json.data;
    if (!mqtt?.host) return;
    config.mqtt.url = `mqtt://${mqtt.host}:${mqtt.port ?? 1883}`;
    config.mqtt.username = mqtt.username ?? "";
    config.mqtt.password = mqtt.password ?? "";
    logger.info({ url: config.mqtt.url }, "Auto-discovered MQTT broker from Supervisor");
  } catch {
    logger.debug("Could not auto-discover MQTT from Supervisor");
  }
}

async function main(): Promise<void> {
  const app = await createServer();

  startHaWebSocket();
  initPresenceFusion();

  // Auto-discover MQTT broker from HA Supervisor if not configured
  await discoverMqttFromSupervisor();

  // Wire MQTT → zone engine → WebSocket → HA actions
  setNodeResolver(loadNodes);
  setAutoCreateNode(autoCreateNodeEntry);

  onTrackFrame((frame) => {
    broadcastEvent("track_update", {
      nodeId: frame.nodeId,
      presence: frame.presence,
      targets: frame.targets,
    });
    const zones = loadZones();
    processTrackFrame(frame, zones);
    processGestureFrame(frame, loadGestures(), zones);
  });

  onZoneEvent((event) => {
    broadcastEvent("zone_event", {
      zoneId: event.zoneId,
      zoneName: event.zoneName,
      eventType: event.type,
      targetCount: event.targetCount,
    });
  });

  onGestureEvent((event) => {
    const bindings = loadGestures();
    const binding = bindings.find((b) => b.id === event.bindingId);
    broadcastEvent("gesture_event", {
      id: event.id,
      bindingId: event.bindingId,
      bindingName: binding?.name ?? event.bindingId,
      zoneId: binding?.zoneId ?? null,
      gesture: event.gesture,
      targetId: event.targetId,
      confidence: event.confidence,
      actionNames: event.actionNames ?? [],
    });
  });

  onGestureDebug((targets) => {
    broadcastEvent("gesture_debug", { targets });
  });

  startMqtt();

  await app.listen({ port: config.port, host: config.host });
  logger.info(`Zegy Sensor Manager running on http://${config.host}:${config.port}`);
  startBackgroundCameraGestures();

  const shutdown = async () => {
    logger.info("Shutting down...");
    stopMqtt();
    await stopBackgroundCameraGestures();
    stopHaWebSocket();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start Zegy");
  process.exit(1);
});

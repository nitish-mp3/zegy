import { config } from "./config";
import { logger } from "./logger";
import { createServer } from "./server";
import { startHaWebSocket, stopHaWebSocket } from "./ha";
import { startMqtt, stopMqtt, onTrackFrame, setNodeResolver } from "./mqtt";
import { processTrackFrame, onZoneEvent } from "./engine";
import { broadcastEvent } from "./ws";
import { loadZones } from "./routes/zones";
import { loadNodes } from "./routes/nodes";

async function main(): Promise<void> {
  const app = await createServer();

  startHaWebSocket();

  // Wire MQTT → zone engine → WebSocket → HA actions
  setNodeResolver(loadNodes);

  onTrackFrame((frame) => {
    broadcastEvent("track_update", {
      nodeId: frame.nodeId,
      presence: frame.presence,
      targets: frame.targets,
    });
    processTrackFrame(frame, loadZones());
  });

  onZoneEvent((event) => {
    broadcastEvent("zone_event", {
      zoneId: event.zoneId,
      zoneName: event.zoneName,
      eventType: event.type,
      targetCount: event.targetCount,
    });
  });

  startMqtt();

  await app.listen({ port: config.port, host: config.host });
  logger.info(`Zegy Sensor Manager running on http://${config.host}:${config.port}`);

  const shutdown = async () => {
    logger.info("Shutting down...");
    stopMqtt();
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

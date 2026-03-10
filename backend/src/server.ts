import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import { config } from "./config";
import { logger } from "./logger";
import {
  healthRoutes,
  deviceRoutes,
  sensorRoutes,
  areaRoutes,
  floorplanRoutes,
  zoneRoutes,
  nodeRoutes,
  settingsRoutes,
} from "./routes";
import { registerWebSocket } from "./ws";

export async function createServer() {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebSocket);

  // API routes
  await app.register(healthRoutes);
  await app.register(deviceRoutes);
  await app.register(sensorRoutes);
  await app.register(areaRoutes);
  await app.register(floorplanRoutes);
  await app.register(zoneRoutes);
  await app.register(nodeRoutes);
  await app.register(settingsRoutes);

  // WebSocket
  await app.register(registerWebSocket);

  // Serve frontend (SPA)
  const distPath = path.resolve(config.frontendDist);
  await app.register(fastifyStatic, {
    root: distPath,
    wildcard: false,
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.sendFile("index.html");
  });

  return app;
}

import type { FastifyInstance } from "fastify";
import type { WebSocket as WsSocket } from "ws";
import { onStateChanged } from "../ha/subscriber";
import { logger } from "../logger";

interface ClientSocket {
  ws: WsSocket;
  subscriptions: Set<string>;
}

const clients = new Set<ClientSocket>();

function broadcast(entityId: string, state: string, attributes: Record<string, unknown>): void {
  const payload = JSON.stringify({
    type: "state_changed",
    entity_id: entityId,
    state,
    attributes,
    timestamp: new Date().toISOString(),
  });

  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;
    if (client.subscriptions.size > 0 && !client.subscriptions.has(entityId)) continue;
    client.ws.send(payload);
  }
}

export function broadcastEvent(type: string, data: Record<string, unknown>): void {
  const payload = JSON.stringify({
    type,
    ...data,
    timestamp: new Date().toISOString(),
  });

  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;
    client.ws.send(payload);
  }
}

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  onStateChanged(broadcast);

  app.get("/api/ws", { websocket: true }, (socket) => {
    const client: ClientSocket = { ws: socket, subscriptions: new Set() };
    clients.add(client);

    logger.info(`WebSocket client connected (total: ${clients.size})`);

    socket.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));

    socket.on("message", (raw) => {
      let msg: { action?: string; entities?: string[] };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.action === "subscribe" && Array.isArray(msg.entities)) {
        for (const e of msg.entities) {
          if (typeof e === "string") client.subscriptions.add(e);
        }
        socket.send(JSON.stringify({ type: "subscribed", entities: [...client.subscriptions] }));
      }

      if (msg.action === "unsubscribe" && Array.isArray(msg.entities)) {
        for (const e of msg.entities) {
          client.subscriptions.delete(e);
        }
        socket.send(JSON.stringify({ type: "unsubscribed", entities: [...client.subscriptions] }));
      }

      if (msg.action === "subscribe_all") {
        client.subscriptions.clear();
        socket.send(JSON.stringify({ type: "subscribed_all" }));
      }
    });

    socket.on("close", () => {
      clients.delete(client);
      logger.info(`WebSocket client disconnected (total: ${clients.size})`);
    });
  });
}

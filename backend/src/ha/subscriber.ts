import WebSocket from "ws";
import { config } from "../config";
import { logger } from "../logger";

type StateChangedCallback = (entityId: string, newState: string, attributes: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let msgId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<StateChangedCallback>();

export function onStateChanged(cb: StateChangedCallback): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function nextId(): number {
  return msgId++;
}

function connect(): void {
  if (ws) return;

  const url = config.ha.websocketUrl;
  logger.info({ url }, "Connecting to HA WebSocket");

  ws = new WebSocket(url);

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "auth_required") {
      ws?.send(
        JSON.stringify({
          type: "auth",
          access_token: config.ha.supervisorToken,
        }),
      );
      return;
    }

    if (msg.type === "auth_ok") {
      logger.info("HA WebSocket authenticated");
      ws?.send(
        JSON.stringify({
          id: nextId(),
          type: "subscribe_events",
          event_type: "state_changed",
        }),
      );
      return;
    }

    if (msg.type === "auth_invalid") {
      logger.error("HA WebSocket auth failed");
      ws?.close();
      return;
    }

    if (msg.type === "event") {
      const event = msg.event as {
        data?: {
          entity_id?: string;
          new_state?: { state: string; attributes: Record<string, unknown> };
        };
      };
      const data = event?.data;
      if (data?.entity_id && data.new_state) {
        for (const cb of listeners) {
          cb(data.entity_id, data.new_state.state, data.new_state.attributes);
        }
      }
    }
  });

  ws.on("close", () => {
    logger.warn("HA WebSocket closed, reconnecting in 5s...");
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    logger.error({ err }, "HA WebSocket error");
    ws?.close();
    ws = null;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

export function startHaWebSocket(): void {
  if (!config.ha.supervisorToken) {
    logger.warn("No HA token — skipping real-time subscriptions");
    return;
  }
  connect();
}

export function stopHaWebSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
  listeners.clear();
}

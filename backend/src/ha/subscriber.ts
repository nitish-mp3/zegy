import WebSocket from "ws";
import { config } from "../config";
import { logger } from "../logger";

type StateChangedCallback = (entityId: string, newState: string, attributes: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let msgId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<StateChangedCallback>();
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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

    if (msg.type === "result") {
      const id = msg.id as number;
      const pending = pendingRequests.get(id);
      if (pending) {
        pendingRequests.delete(id);
        if (msg.success) {
          pending.resolve(msg.result);
        } else {
          const errMsg = (msg.error as { message?: string })?.message ?? "WS command failed";
          pending.reject(new Error(errMsg));
        }
      }
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
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error("WebSocket closed"));
    }
    pendingRequests.clear();
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
  for (const pending of pendingRequests.values()) {
    pending.reject(new Error("WebSocket closed"));
  }
  pendingRequests.clear();
  ws?.close();
  ws = null;
  listeners.clear();
}

export function callWs<T>(type: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!ws || ws.readyState !== 1) {
      reject(new Error("WebSocket not open"));
      return;
    }
    const id = nextId();
    pendingRequests.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    ws.send(JSON.stringify({ id, type, ...params }));
  });
}

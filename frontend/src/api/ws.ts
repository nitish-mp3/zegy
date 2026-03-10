type MessageHandler = (data: Record<string, unknown>) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 500;
const MAX_RECONNECT_DELAY = 8000;
const handlers = new Set<MessageHandler>();

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const m = location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/);
  const base = m ? m[0] : "";
  return `${proto}//${location.host}${base}/api/ws`;
}

function connect(): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    reconnectDelay = 500;
    socket?.send(JSON.stringify({ action: "subscribe_all" }));
  };

  socket.onmessage = (event) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const h of handlers) h(data);
  };

  socket.onclose = () => {
    socket = null;
    for (const h of handlers) h({ type: "disconnected" });
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// Reconnect when tab becomes visible again
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && handlers.size > 0) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reconnectDelay = 500;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        connect();
      }
    }
  });
}

export function subscribe(handler: MessageHandler): () => void {
  handlers.add(handler);
  if (!socket || socket.readyState !== WebSocket.OPEN) connect();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      socket?.close();
      socket = null;
    }
  };
}

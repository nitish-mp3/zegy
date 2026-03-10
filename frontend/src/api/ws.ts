type MessageHandler = (data: Record<string, unknown>) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<MessageHandler>();

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/ws`;
}

function connect(): void {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
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
  }, 3000);
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

export function formatEntityName(entityId: string): string {
  const parts = entityId.split(".");
  return (parts[1] ?? entityId).replaceAll("_", " ");
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function classifyStatus(
  value: string | number,
): "normal" | "warning" | "critical" {
  if (value === "unavailable" || value === "unknown") return "warning";
  return "normal";
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count !== 1 ? "s" : ""}`;
}

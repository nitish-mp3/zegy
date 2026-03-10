import { useEffect, useState, useMemo } from "react";
import { useZones, type Zone } from "../hooks/useZones";
import { subscribe } from "../api/ws";
import { formatEntityName } from "../utils/format";
import { api } from "../api/client";

interface ZoneEvent {
  zoneId: string;
  zoneName: string;
  type: "enter" | "exit";
  targetCount: number;
  timestamp: string;
}

export default function Automations() {
  const { zones, update: updateZone, refresh } = useZones();
  const [recentEvents, setRecentEvents] = useState<ZoneEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Load recent events
  useEffect(() => {
    api.getZoneActivity()
      .then((events) => setRecentEvents(events))
      .catch(() => {})
      .finally(() => setLoadingEvents(false));
  }, []);

  // Subscribe to live zone events
  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type === "zone_event") {
        const evt = data as unknown as ZoneEvent;
        setRecentEvents((prev) => [evt, ...prev].slice(0, 50));
        refresh();
      }
    });
    return unsub;
  }, [refresh]);

  const handleToggle = async (zone: Zone) => {
    await updateZone(zone.id, { ...zone, enabled: !zone.enabled });
  };

  const stats = useMemo(() => {
    const total = zones.length;
    const active = zones.filter((z) => z.state?.occupied).length;
    const enabled = zones.filter((z) => z.enabled).length;
    const totalActions = zones.reduce(
      (sum, z) => sum + z.onEnter.length + z.onExit.length,
      0,
    );
    return { total, active, enabled, totalActions };
  }, [zones]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Automations</h1>
        <p className="page-subtitle">Zone-based presence automations and activity</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Zones", value: stats.total, color: "text-gray-200" },
          { label: "Active Now", value: stats.active, color: "text-zegy-400" },
          { label: "Enabled", value: stats.enabled, color: "text-blue-400" },
          { label: "Total Actions", value: stats.totalActions, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3.5">
            <p className="text-[11px] text-gray-600">{s.label}</p>
            <p className={`text-2xl font-semibold tabular-nums ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Zone cards */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="section-title">Zones</h2>
          {zones.length === 0 ? (
            <div className="card flex items-center justify-center py-16">
              <p className="text-sm text-gray-600">No zones configured. Go to Zones to create one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {zones.map((z) => (
                <div
                  key={z.id}
                  className="card flex items-start gap-4 p-4 transition-all hover:bg-white/[0.02]"
                >
                  {/* Color dot & status */}
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: z.color }}
                    />
                    {z.state?.occupied && (
                      <span className="h-1.5 w-1.5 rounded-full bg-zegy-400 animate-pulse" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-gray-200 truncate">{z.name}</h3>
                      {!z.enabled && (
                        <span className="badge bg-gray-800 text-gray-500 text-[10px]">disabled</span>
                      )}
                    </div>

                    {/* Action summary */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
                      {z.onEnter.length > 0 && (
                        <span>
                          Enter: {z.onEnter.map((a) => `${formatEntityName(a.entityId)} → ${a.service}`).join(", ")}
                        </span>
                      )}
                      {z.onExit.length > 0 && (
                        <span>
                          Exit: {z.onExit.map((a) => `${formatEntityName(a.entityId)} → ${a.service}`).join(", ")}
                        </span>
                      )}
                      {z.onEnter.length + z.onExit.length === 0 && (
                        <span className="text-gray-700">No actions</span>
                      )}
                    </div>

                    {/* State */}
                    {z.state?.occupied && (
                      <p className="mt-1 text-[11px] text-zegy-400/80">
                        {z.state.targetCount} target{z.state.targetCount !== 1 ? "s" : ""} detected
                      </p>
                    )}
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(z)}
                    className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
                      z.enabled ? "bg-zegy-600" : "bg-gray-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                        z.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div>
          <h2 className="section-title">Recent Activity</h2>
          <div className="card p-4 max-h-[300px] sm:max-h-[400px] lg:max-h-[600px] overflow-y-auto">
            {loadingEvents ? (
              <p className="text-xs text-gray-700">Loading...</p>
            ) : recentEvents.length === 0 ? (
              <p className="text-xs text-gray-700">No activity yet</p>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((evt, i) => (
                  <div key={`${evt.timestamp}-${i}`} className="flex items-start gap-2.5 py-1.5">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        evt.type === "enter" ? "bg-zegy-400" : "bg-amber-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-300">
                        <span className="font-medium">{evt.zoneName}</span>{" "}
                        <span className="text-gray-600">
                          {evt.type === "enter" ? "entered" : "exited"}
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-700 tabular-nums">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

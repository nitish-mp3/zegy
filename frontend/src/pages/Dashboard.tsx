import { useState, useEffect } from "react";
import { useDevices } from "../hooks/useDevices";
import StatCard from "../components/StatCard";
import DeviceCard from "../components/DeviceCard";
import SensorGauge from "../components/SensorGauge";
import { api } from "../api/client";
import { formatEntityName, pluralize } from "../utils/format";

interface SensorSummary {
  total: number;
  available: number;
  unavailable: number;
  byClass: Record<string, number>;
}

export default function Dashboard() {
  const { devices, loading, error, refresh } = useDevices();
  const [summary, setSummary] = useState<SensorSummary | null>(null);

  useEffect(() => {
    api.getSensorSummary().then(setSummary).catch(() => {});
  }, []);

  if (loading && devices.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zegy-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-rose-900/40 bg-rose-950/20 p-6 text-center">
        <p className="text-rose-400">{error}</p>
        <button onClick={refresh} className="btn-secondary mt-3 text-rose-300">
          Retry
        </button>
      </div>
    );
  }

  const allSensors = devices.flatMap((d) => d.sensors);
  const recentSensors = allSensors
    .filter((s) => s.value !== "unavailable" && s.value !== "unknown")
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Live sensor status across all devices</p>
        </div>
        <button onClick={refresh} className="btn-secondary">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Devices" value={devices.length} color="teal" subtitle="Connected" />
        <StatCard
          title="Sensors"
          value={summary?.total ?? allSensors.length}
          color="emerald"
          subtitle={`${summary?.available ?? 0} reporting`}
        />
        <StatCard
          title="Offline"
          value={summary?.unavailable ?? 0}
          color={summary?.unavailable ? "amber" : "emerald"}
          subtitle="Need attention"
        />
        <StatCard
          title="Areas"
          value={new Set(devices.map((d) => d.area).filter(Boolean)).size}
          color="teal"
          subtitle="Mapped locations"
        />
      </div>

      {recentSensors.length > 0 && (
        <section>
          <h2 className="section-title">Live Readings</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentSensors.map((s) => (
              <SensorGauge
                key={s.entityId}
                label={formatEntityName(s.entityId)}
                value={s.value}
                unit={s.unit}
                deviceClass={s.deviceClass}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Devices</h2>
        {devices.length === 0 ? (
          <div className="card p-8 text-center text-gray-600">
            No sensor devices discovered. Verify the Home Assistant connection.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

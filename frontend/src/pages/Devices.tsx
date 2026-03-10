import { useState } from "react";
import { useDevices } from "../hooks/useDevices";
import DeviceCard from "../components/DeviceCard";
import SensorGauge from "../components/SensorGauge";
import { formatEntityName, pluralize } from "../utils/format";
import type { DeviceSummary } from "../contexts/AppContext";

export default function Devices() {
  const { devices, loading, error, refresh } = useDevices();
  const [selected, setSelected] = useState<DeviceSummary | null>(null);
  const [search, setSearch] = useState("");

  const filtered = devices.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.manufacturer.toLowerCase().includes(search.toLowerCase()) ||
      d.area?.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading && devices.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zegy-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Devices</h1>
          <p className="page-subtitle">{pluralize(devices.length, "device")} discovered</p>
        </div>
        <button onClick={refresh} className="btn-secondary">
          Refresh
        </button>
      </div>

      <input
        type="text"
        placeholder="Search by name, manufacturer, or area…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input w-full"
      />

      {error && (
        <div className="card border-rose-900/40 bg-rose-950/20 p-4 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="flex gap-6">
        <div className="flex-1">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((d) => (
              <DeviceCard key={d.id} device={d} onClick={() => setSelected(d)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="card p-8 text-center text-gray-600">
              {search ? "No matches found" : "No devices discovered"}
            </div>
          )}
        </div>

        {selected && (
          <aside className="hidden w-80 xl:w-96 shrink-0 lg:block">
            <div className="card sticky top-0 space-y-4 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-100">{selected.name}</h2>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-600 transition-colors hover:text-gray-300"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-2.5 text-sm">
                {(["manufacturer", "model", "area", "firmware"] as const).map((key) => (
                  <div key={key} className="flex justify-between">
                    <span className="capitalize text-gray-600">{key}</span>
                    <span className="text-gray-300">{selected[key] || "—"}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/[0.06] pt-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-600">Sensors</h3>
                <div className="space-y-2">
                  {selected.sensors.map((s) => (
                    <SensorGauge
                      key={s.entityId}
                      label={formatEntityName(s.entityId)}
                      value={s.value}
                      unit={s.unit}
                      deviceClass={s.deviceClass}
                      status={
                        s.value === "unavailable" || s.value === "unknown"
                          ? "warning"
                          : "normal"
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

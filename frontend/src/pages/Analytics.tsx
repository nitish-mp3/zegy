import { useState, useEffect, useMemo } from "react";
import { api } from "../api/client";
import { useDevices } from "../hooks/useDevices";
import { pluralize } from "../utils/format";

interface SensorSummary {
  total: number;
  available: number;
  unavailable: number;
  byClass: Record<string, number>;
}

export default function Analytics() {
  const { devices } = useDevices();
  const [summary, setSummary] = useState<SensorSummary | null>(null);

  useEffect(() => {
    api.getSensorSummary().then(setSummary).catch(() => {});
  }, []);

  const areaStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of devices) {
      const area = d.area ?? "Unassigned";
      map.set(area, (map.get(area) ?? 0) + d.sensors.length);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [devices]);

  const deviceClassEntries = summary
    ? Object.entries(summary.byClass).sort((a, b) => b[1] - a[1])
    : [];

  const maxClassCount = deviceClassEntries.length > 0 ? deviceClassEntries[0][1] : 1;
  const maxAreaCount = areaStats.length > 0 ? areaStats[0][1] : 1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Insights</h1>
        <p className="page-subtitle">Sensor distribution &amp; system health</p>
      </div>

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-5 text-center">
            <p className="text-4xl font-bold tabular-nums text-zegy-400">{summary.total}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-gray-600">Total Sensors</p>
          </div>
          <div className="card p-5 text-center">
            <p className="text-4xl font-bold tabular-nums text-emerald-400">{summary.available}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-gray-600">Reporting</p>
          </div>
          <div className="card p-5 text-center">
            <p className={`text-4xl font-bold tabular-nums ${summary.unavailable > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {summary.unavailable}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-gray-600">Offline</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="section-title">By Device Class</h2>
          {deviceClassEntries.length === 0 ? (
            <p className="text-sm text-gray-700">No data yet</p>
          ) : (
            <div className="space-y-3">
              {deviceClassEntries.map(([cls, count]) => (
                <div key={cls}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-300">{cls}</span>
                    <span className="tabular-nums text-gray-600">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-zegy-600 to-zegy-400 transition-all"
                      style={{ width: `${(count / maxClassCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="section-title">By Area</h2>
          {areaStats.length === 0 ? (
            <p className="text-sm text-gray-700">No data yet</p>
          ) : (
            <div className="space-y-3">
              {areaStats.map(([area, count]) => (
                <div key={area}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-300">{area}</span>
                    <span className="tabular-nums text-gray-600">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
                      style={{ width: `${(count / maxAreaCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card p-6">
        <h2 className="section-title">Device Health</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-gray-700">No devices discovered</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] sm:text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-gray-600">
                  <th className="pb-3 pr-3 sm:pr-6 font-medium">Device</th>
                  <th className="pb-3 pr-3 sm:pr-6 font-medium hidden sm:table-cell">Area</th>
                  <th className="pb-3 pr-3 sm:pr-6 font-medium">Sensors</th>
                  <th className="pb-3 pr-3 sm:pr-6 font-medium">Offline</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {devices.map((d) => {
                  const unavail = d.sensors.filter(
                    (s) => s.value === "unavailable" || s.value === "unknown",
                  ).length;
                  return (
                    <tr key={d.id} className="text-gray-300">
                      <td className="py-3 pr-3 sm:pr-6 font-medium truncate max-w-[120px] sm:max-w-none">{d.name}</td>
                      <td className="py-3 pr-3 sm:pr-6 text-gray-600 hidden sm:table-cell">{d.area ?? "\u2014"}</td>
                      <td className="py-3 pr-3 sm:pr-6 tabular-nums">{d.sensors.length}</td>
                      <td className="py-3 pr-3 sm:pr-6 tabular-nums">
                        <span className={unavail > 0 ? "text-amber-400" : "text-gray-600"}>
                          {unavail}
                        </span>
                      </td>
                      <td className="py-3">
                        <span
                          className={`badge text-[11px] ${
                            unavail === 0
                              ? "bg-emerald-500/10 text-emerald-400"
                              : unavail < d.sensors.length
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {unavail === 0 ? "Healthy" : unavail < d.sensors.length ? "Degraded" : "Offline"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

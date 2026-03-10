import type { DeviceSummary } from "../contexts/AppContext";
import { formatEntityName, pluralize } from "../utils/format";

interface Props {
  device: DeviceSummary;
  onClick?: () => void;
}

export default function DeviceCard({ device, onClick }: Props) {
  const unavailable = device.sensors.filter(
    (s) => s.value === "unavailable" || s.value === "unknown",
  ).length;

  return (
    <button
      onClick={onClick}
      className="card-hover flex flex-col gap-3 p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-zegy-500/40"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zegy-600/10 text-zegy-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-gray-100">{device.name}</h3>
            <p className="text-xs text-gray-600">
              {[device.manufacturer, device.model].filter(Boolean).join(" · ") || "Unknown device"}
            </p>
          </div>
        </div>
        <span
          className={`mt-1 h-2 w-2 rounded-full ${device.online ? "bg-zegy-400" : "bg-rose-400"}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {device.area && (
          <span className="badge bg-white/[0.05] text-gray-400">{device.area}</span>
        )}
        <span className="text-gray-600">{pluralize(device.sensors.length, "sensor")}</span>
        {unavailable > 0 && (
          <span className="text-amber-400">{unavailable} offline</span>
        )}
      </div>

      {device.sensors.length > 0 && (
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {device.sensors.slice(0, 4).map((s) => (
            <div key={s.entityId} className="rounded-lg bg-white/[0.03] px-3 py-2">
              <p className="truncate text-[11px] text-gray-600">{formatEntityName(s.entityId)}</p>
              <p className="text-sm font-medium tabular-nums text-gray-200">
                {s.value}
                {s.unit && <span className="ml-1 text-[11px] font-normal text-gray-600">{s.unit}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {device.sensors.length > 4 && (
        <p className="text-[11px] text-gray-600">+{device.sensors.length - 4} more</p>
      )}
    </button>
  );
}

import { useApp } from "../contexts/AppContext";
import { pluralize } from "../utils/format";

interface Props {
  onMenuToggle: () => void;
}

export default function Header({ onMenuToggle }: Props) {
  const { state } = useApp();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-surface-raised/80 px-4 backdrop-blur-md md:px-6">
      <button
        onClick={onMenuToggle}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200 md:hidden"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      <div className="hidden md:block" />

      <div className="flex items-center gap-3">
        {state.devices.length > 0 && (
          <span className="badge bg-white/[0.06] text-gray-400">
            {pluralize(state.devices.length, "device")}
          </span>
        )}

        <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              state.connected
                ? "bg-zegy-400 shadow-sm shadow-zegy-400/50"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className="text-[11px] font-medium text-gray-500">
            {state.connected ? "Connected" : "Reconnecting"}
          </span>
        </div>
      </div>
    </header>
  );
}

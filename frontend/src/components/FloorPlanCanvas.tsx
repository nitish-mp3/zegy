import { useRef, useState, useCallback, useEffect } from "react";
import type { FloorPlanLayout } from "../contexts/AppContext";

interface Props {
  layout: FloorPlanLayout;
  onLayoutChange: (layout: FloorPlanLayout) => void;
  sensorValues?: Map<string, { value: string | number; unit: string }>;
}

export default function FloorPlanCanvas({ layout, onLayoutChange, sensorValues }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      const node = layout.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setDragging(nodeId);
      setOffset({ x: e.clientX - node.x, y: e.clientY - node.y });
    },
    [layout.nodes],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = Math.max(0, Math.min(e.clientX - offset.x, layout.width - 40));
      const y = Math.max(0, Math.min(e.clientY - offset.y, layout.height - 40));

      const newNodes = layout.nodes.map((n) =>
        n.id === dragging ? { ...n, x, y } : n,
      );
      onLayoutChange({ ...layout, nodes: newNodes });
    },
    [dragging, offset, layout, onLayoutChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  return (
    <div
      ref={canvasRef}
      className="card relative overflow-hidden"
      style={{ width: layout.width, height: layout.height }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDragging(null)}
    >
      {layout.backgroundUrl && (
        <img
          src={layout.backgroundUrl}
          alt="Floor plan"
          className="absolute inset-0 h-full w-full object-contain opacity-20"
          draggable={false}
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {layout.nodes.map((node) => {
        const sv = sensorValues?.get(node.entityId);
        return (
          <div
            key={node.id}
            className={`absolute flex cursor-grab flex-col items-center gap-1 select-none transition-shadow ${
              dragging === node.id ? "cursor-grabbing z-20" : "z-10"
            }`}
            style={{ left: node.x, top: node.y }}
            onMouseDown={(e) => handleMouseDown(node.id, e)}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-zegy-400 to-zegy-600 shadow-lg shadow-zegy-500/25">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
            <div className="rounded-lg bg-surface-overlay/90 px-2 py-1 text-center backdrop-blur-sm">
              <p className="text-[10px] text-gray-500">{node.label}</p>
              {sv && (
                <p className="text-xs font-semibold tabular-nums text-zegy-300">
                  {sv.value}{sv.unit && ` ${sv.unit}`}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {layout.nodes.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-700">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z" />
          </svg>
          <p className="text-sm">Add sensors from the panel to begin</p>
        </div>
      )}
    </div>
  );
}

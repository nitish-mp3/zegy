import { useRef, useState, useCallback, useEffect, memo } from "react";
import { snapToGrid } from "../utils/calibration";
import type { AffineParams, CalibrationPoint } from "../utils/calibration";

/* Types */

export interface ZonePoint {
  x: number;
  y: number;
}

export interface Zone {
  id: string;
  name: string;
  color: string;
  points: ZonePoint[];
  enabled: boolean;
  state?: { occupied: boolean; targetCount: number };
}

export interface TrackTarget {
  id: number;
  x: number;
  y: number;
  speed: number;
  opacity?: number;
  stale?: boolean;
  nodeId?: string;
  lastSeen?: number;
}

export interface StaticEcho {
  x: number;
  y: number;
  strength: number;
}

export interface TrackHistoryPoint {
  id: string;
  x: number;
  y: number;
  ageMs: number;
}

export interface SensorNodeMarker {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  status: "online" | "offline" | "unknown";
}

export type EditorMode = "view" | "draw" | "edit" | "calibrate" | "validate";

export interface CanvasProps {
  roomWidth: number;
  roomHeight: number;
  gridStep: number;
  snapEnabled: boolean;
  affine: AffineParams | null;
  inverse: AffineParams | null;
  calibrationPoints: CalibrationPoint[];
  zones: Zone[];
  sensorNodes: SensorNodeMarker[];
  trackTargets: TrackTarget[];
  trackHistory: TrackHistoryPoint[];
  staticEchoes: StaticEcho[];
  mode: EditorMode;
  selectedZoneId: string | null;
  drawingPoints: ZonePoint[];
  editingVertexIdx: number | null;
  showCoverage: boolean;
  showMotionHistory: boolean;
  showGrid: boolean;
  showLabels: boolean;
  triggeredZoneIds: Set<string>;
  onCanvasClick: (rx: number, ry: number) => void;
  onCanvasMouseMove: (rx: number, ry: number) => void;
  onZoneClick: (id: string) => void;
  onVertexDragStart: (zoneId: string, vertexIdx: number) => void;
  onVertexDrag: (rx: number, ry: number) => void;
  onVertexDragEnd: () => void;
  onCalibrationPointClick: (px: number, py: number) => void;
}

/* Helpers */

function polygonCenter(pts: ZonePoint[]): ZonePoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x: cx, y: cy };
}

function buildCoveragePath(node: SensorNodeMarker, scale: number): string {
  const r = (node.status === "online" ? 5.0 : 3.0) * scale;
  const halfAngle = 60;
  const dir = node.rotation - 90;
  const a1 = ((dir - halfAngle) * Math.PI) / 180;
  const a2 = ((dir + halfAngle) * Math.PI) / 180;
  const cx = node.x * scale;
  const cy = node.y * scale;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

function buildDistanceRings(node: SensorNodeMarker, scale: number): React.ReactNode[] {
  const cx = node.x * scale;
  const cy = node.y * scale;
  const rings = [1, 2, 3, 4];
  return rings.map((d) => {
    const r = d * scale;
    return (
      <g key={`ring-${node.id}-${d}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2dd4b4" strokeWidth="0.5" strokeDasharray="4 6" opacity={0.12} />
        <text x={cx + r + 3} y={cy - 3} fill="#2dd4b4" fontSize="7" opacity={0.2} className="select-none pointer-events-none">{d}m</text>
      </g>
    );
  });
}

const TRACK_COLORS = ["#f59e0b", "#3b82f6", "#ef4444", "#a855f7", "#06b6d4", "#f97316"];

/* Component */

export default memo(function ZoneCanvas({
  roomWidth,
  roomHeight,
  gridStep,
  snapEnabled,
  calibrationPoints,
  zones,
  sensorNodes,
  trackTargets,
  trackHistory,
  staticEchoes,
  mode,
  selectedZoneId,
  drawingPoints,
  editingVertexIdx,
  showCoverage,
  showMotionHistory,
  showGrid,
  showLabels,
  triggeredZoneIds,
  onCanvasClick,
  onCanvasMouseMove,
  onZoneClick,
  onVertexDragStart,
  onVertexDrag,
  onVertexDragEnd,
  onCalibrationPointClick,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<ZonePoint | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const SCALE = 100;
  const MARGIN = 1;
  const vw = roomWidth * SCALE;
  const vh = roomHeight * SCALE;
  const mx = MARGIN * SCALE;
  const totalVw = vw + 2 * mx;
  const totalVh = vh + 2 * mx;

  const clientToRoom = useCallback(
    (clientX: number, clientY: number): ZonePoint => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const fullW = roomWidth + 2 * MARGIN;
      const fullH = roomHeight + 2 * MARGIN;
      let rx = ((clientX - rect.left) / rect.width) * fullW - MARGIN;
      let ry = ((clientY - rect.top) / rect.height) * fullH - MARGIN;
      if (snapEnabled && mode === "draw") {
        rx = snapToGrid(rx, gridStep);
        ry = snapToGrid(ry, gridStep);
      }
      return { x: rx, y: ry };
    },
    [roomWidth, roomHeight, snapEnabled, mode, gridStep],
  );

  const r2s = useCallback((rx: number, ry: number) => ({ x: rx * SCALE, y: ry * SCALE }), []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode === "calibrate") {
        const pos = clientToRoom(e.clientX, e.clientY);
        onCalibrationPointClick(pos.x, pos.y);
        return;
      }
      if (isDragging) return;
      const pos = clientToRoom(e.clientX, e.clientY);
      if (mode === "draw" || mode === "view" || mode === "validate") {
        onCanvasClick(pos.x, pos.y);
      }
    },
    [mode, isDragging, clientToRoom, onCanvasClick, onCalibrationPointClick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pos = clientToRoom(e.clientX, e.clientY);
      setMousePos(pos);
      onCanvasMouseMove(pos.x, pos.y);
      if (isDragging) {
        onVertexDrag(pos.x, pos.y);
      }
    },
    [clientToRoom, isDragging, onCanvasMouseMove, onVertexDrag],
  );

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      onVertexDragEnd();
    }
  }, [isDragging, onVertexDragEnd]);

  const handleVertexPointerDown = useCallback(
    (e: React.PointerEvent, zoneId: string, idx: number) => {
      e.stopPropagation();
      e.preventDefault();
      setIsDragging(true);
      onVertexDragStart(zoneId, idx);
    },
    [onVertexDragStart],
  );

  /* Grid Lines */
  const gridLines: React.ReactNode[] = [];
  if (showGrid) {
    for (let x = 0; x <= roomWidth; x += gridStep) {
      const sx = x * SCALE;
      const isMajor = x % 1 === 0;
      gridLines.push(
        <line key={`gx-${x}`} x1={sx} y1={0} x2={sx} y2={vh} stroke="rgba(255,255,255,0.06)" strokeWidth={isMajor ? 1 : 0.5} />,
      );
      if (isMajor && showLabels) {
        gridLines.push(
          <text key={`lx-${x}`} x={sx + 3} y={12} fill="rgba(255,255,255,0.25)" fontSize="9" className="select-none pointer-events-none">{x}m</text>,
        );
      }
    }
    for (let y = 0; y <= roomHeight; y += gridStep) {
      const sy = y * SCALE;
      const isMajor = y % 1 === 0;
      gridLines.push(
        <line key={`gy-${y}`} x1={0} y1={sy} x2={vw} y2={sy} stroke="rgba(255,255,255,0.06)" strokeWidth={isMajor ? 1 : 0.5} />,
      );
      if (isMajor && showLabels && y > 0) {
        gridLines.push(
          <text key={`ly-${y}`} x={3} y={sy - 3} fill="rgba(255,255,255,0.25)" fontSize="9" className="select-none pointer-events-none">{y}m</text>,
        );
      }
    }
  }

  const cursor =
    mode === "draw" || mode === "calibrate" ? "crosshair" :
    isDragging ? "grabbing" :
    "default";

  return (
    <div ref={containerRef} className="card relative overflow-hidden touch-none" style={{ aspectRatio: `${roomWidth + 2 * MARGIN} / ${roomHeight + 2 * MARGIN}` }}>
      {/* Coordinate readout */}
      {mousePos && (mode === "draw" || mode === "calibrate" || mode === "edit") && (
        <div className="absolute right-2 top-2 z-10 rounded-lg bg-surface/90 px-2 py-1 text-[10px] font-mono text-gray-400 backdrop-blur-sm border border-white/[0.06]">
          {mousePos.x.toFixed(2)}m, {mousePos.y.toFixed(2)}m
        </div>
      )}

      {/* Mode label */}
      {mode !== "view" && (
        <div className="absolute left-2 top-2 z-10">
          <span className={`badge text-[10px] ${
            mode === "draw" ? "bg-zegy-500/15 text-zegy-400" :
            mode === "calibrate" ? "bg-amber-500/15 text-amber-400" :
            mode === "validate" ? "bg-blue-500/15 text-blue-400" :
            mode === "edit" ? "bg-purple-500/15 text-purple-400" :
            "bg-gray-500/15 text-gray-400"
          }`}>
            {mode === "draw" ? "Drawing" : mode === "calibrate" ? "Calibrating" : mode === "validate" ? "Validating" : mode === "edit" ? "Editing" : mode}
          </span>
        </div>
      )}

      {/* Live target count badge */}
      {trackTargets.length > 0 && (
        <div className="absolute left-2 bottom-2 z-10 flex items-center gap-1.5 rounded-lg bg-surface/90 px-2 py-1 text-[10px] text-gray-400 backdrop-blur-sm border border-white/[0.06]">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          {trackTargets.length} target{trackTargets.length !== 1 ? "s" : ""} tracked
        </div>
      )}

      <svg ref={svgRef} viewBox={`${-mx} ${-mx} ${totalVw} ${totalVh}`} className="w-full h-full select-none" style={{ cursor }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}>
        {/* Background */}
        <defs>
          <radialGradient id="zc-surface" cx="50%" cy="50%" r="75%">
            <stop offset="0%" stopColor="rgba(20, 184, 156, 0.08)" />
            <stop offset="55%" stopColor="rgba(12, 16, 24, 0.10)" />
            <stop offset="100%" stopColor="rgba(8, 10, 16, 0.85)" />
          </radialGradient>
        </defs>
        <rect x={-mx} y={-mx} width={totalVw} height={totalVh} fill="#080a10" />
        <rect width={vw} height={vh} fill="url(#zc-surface)" rx={2} />

        {/* Room boundary walls */}
        <rect x={1} y={1} width={vw - 2} height={vh - 2} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={2} rx={2} className="pointer-events-none" />
        <line x1={0} y1={0} x2={12} y2={0} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={0} y1={0} x2={0} y2={12} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={vw} y1={0} x2={vw - 12} y2={0} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={vw} y1={0} x2={vw} y2={12} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={0} y1={vh} x2={12} y2={vh} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={0} y1={vh} x2={0} y2={vh - 12} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={vw} y1={vh} x2={vw - 12} y2={vh} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />
        <line x1={vw} y1={vh} x2={vw} y2={vh - 12} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeLinecap="round" className="pointer-events-none" />

        {/* Grid */}
        {gridLines}

        {/* Origin crosshair */}
        <line x1={0} y1={0} x2={20} y2={0} stroke="#ef4444" strokeWidth={2} opacity={0.6} />
        <line x1={0} y1={0} x2={0} y2={20} stroke="#22c55e" strokeWidth={2} opacity={0.6} />
        <text x={22} y={5} fill="#ef4444" fontSize="8" opacity={0.6} className="select-none pointer-events-none">X</text>
        <text x={4} y={28} fill="#22c55e" fontSize="8" opacity={0.6} className="select-none pointer-events-none">Y</text>

        {/* Sensor coverage cones + distance rings */}
        {showCoverage && sensorNodes.map((node) => {
          const isOnline = node.status === "online";
          const stroke = isOnline ? "#2dd4b4" : node.status === "offline" ? "#ef4444" : "#6b7280";
          return (
            <g key={`cov-${node.id}`} className="pointer-events-none">
              {isOnline && buildDistanceRings(node, SCALE)}
              <path d={buildCoveragePath(node, SCALE)} fill={stroke} fillOpacity={isOnline ? 0.07 : 0.03} stroke={stroke} strokeOpacity={isOnline ? 0.35 : 0.15} strokeWidth={isOnline ? "1.5" : "1"} strokeDasharray={isOnline ? undefined : "6 3"} />
            </g>
          );
        })}

        {/* Static environment echoes */}
        {staticEchoes.map((echo, i) => {
          const s = r2s(echo.x, echo.y);
          const op = Math.max(0.05, echo.strength * 0.55);
          const r = 2.5 + echo.strength * 2.5;
          return (
            <circle
              key={`echo-${i}`}
              cx={s.x}
              cy={s.y}
              r={r}
              fill="#94a3b8"
              fillOpacity={op}
              stroke="#94a3b8"
              strokeOpacity={op * 0.4}
              strokeWidth={0.5}
              className="pointer-events-none"
            />
          );
        })}

        {/* Motion history trail */}
        {showMotionHistory && trackHistory.map((point) => {
          const opacity = Math.max(0.06, 0.40 - point.ageMs / 18000);
          const r = Math.max(1.5, 4 - point.ageMs / 4000);
          const s = r2s(point.x, point.y);
          return (
            <circle key={point.id} cx={s.x} cy={s.y} r={r} fill="#38bdf8" fillOpacity={opacity} className="pointer-events-none" />
          );
        })}

        {/* Zone polygons */}
        {zones.map((zone) => {
          const isSelected = zone.id === selectedZoneId;
          const isHovered = zone.id === hoveredZoneId;
          const isOccupied = zone.state?.occupied;
          const isTriggered = triggeredZoneIds.has(zone.id);
          const pts = zone.points.map((p) => { const s = r2s(p.x, p.y); return `${s.x},${s.y}`; }).join(" ");
          const center = polygonCenter(zone.points);
          const sc = r2s(center.x, center.y);

          return (
            <g key={zone.id}>
              <polygon
                points={pts}
                fill={zone.color}
                fillOpacity={!zone.enabled ? 0.04 : isTriggered ? 0.45 : isOccupied ? 0.30 : isSelected ? 0.22 : isHovered ? 0.15 : 0.08}
                stroke={zone.color}
                strokeWidth={isSelected ? 2.5 : isTriggered ? 3 : 1.5}
                strokeOpacity={zone.enabled ? (isSelected || isHovered || isTriggered ? 1 : 0.5) : 0.15}
                className="cursor-pointer"
                style={{ transition: "fill-opacity 200ms ease, stroke-width 150ms ease", ...(isTriggered ? { filter: `drop-shadow(0 0 8px ${zone.color})` } : {}) }}
                onClick={(e) => { e.stopPropagation(); onZoneClick(zone.id); }}
                onPointerEnter={() => setHoveredZoneId(zone.id)}
                onPointerLeave={() => setHoveredZoneId(null)}
              />
              {showLabels && (
                <text x={sc.x} y={sc.y - 6} textAnchor="middle" dominantBaseline="middle" fill={zone.color} fontSize="11" fontWeight="600" className="pointer-events-none select-none" opacity={zone.enabled ? 0.9 : 0.3}>
                  {zone.name}
                </text>
              )}
              {(isOccupied || isTriggered) && zone.enabled && (
                <circle cx={sc.x} cy={sc.y + 10} r="4" fill={zone.color}>
                  <animate attributeName="r" values="3;6;3" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              {!zone.enabled && showLabels && (
                <text x={sc.x} y={sc.y + 10} textAnchor="middle" dominantBaseline="middle" fill="#6b7280" fontSize="8" className="pointer-events-none select-none">disabled</text>
              )}
              {isSelected && (mode === "edit" || mode === "view") && zone.points.map((p, i) => {
                const s = r2s(p.x, p.y);
                const isEditing = editingVertexIdx === i;
                return (
                  <circle key={`v-${zone.id}-${i}`} cx={s.x} cy={s.y} r={isEditing ? 7 : 5} fill={isEditing ? "#fff" : zone.color} stroke="#fff" strokeWidth={1.5} className="cursor-grab"
                    onPointerDown={(e) => handleVertexPointerDown(e, zone.id, i)} />
                );
              })}
            </g>
          );
        })}

        {/* Drawing preview */}
        {mode === "draw" && drawingPoints.length > 0 && (
          <g className="pointer-events-none">
            {drawingPoints.length >= 3 && (
              <polygon points={drawingPoints.map((p) => { const s = r2s(p.x, p.y); return `${s.x},${s.y}`; }).join(" ")} fill="#14b89c" fillOpacity={0.08} />
            )}
            <polyline points={drawingPoints.map((p) => { const s = r2s(p.x, p.y); return `${s.x},${s.y}`; }).join(" ")} fill="none" stroke="#14b89c" strokeWidth={2} strokeDasharray="6 3" />
            {mousePos && (() => {
              const last = drawingPoints[drawingPoints.length - 1];
              const sl = r2s(last.x, last.y);
              const sm = r2s(mousePos.x, mousePos.y);
              return <line x1={sl.x} y1={sl.y} x2={sm.x} y2={sm.y} stroke="#14b89c" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />;
            })()}
            {mousePos && drawingPoints.length >= 3 && (() => {
              const sf = r2s(drawingPoints[0].x, drawingPoints[0].y);
              const sm = r2s(mousePos.x, mousePos.y);
              return <line x1={sm.x} y1={sm.y} x2={sf.x} y2={sf.y} stroke="#14b89c" strokeWidth={1} strokeDasharray="4 4" opacity={0.25} />;
            })()}
            {drawingPoints.map((p, i) => {
              const s = r2s(p.x, p.y);
              const isFirst = i === 0 && drawingPoints.length >= 3;
              return <circle key={i} cx={s.x} cy={s.y} r={isFirst ? 8 : 4} fill={isFirst ? "#14b89c" : "rgba(20,184,156,0.6)"} stroke="#14b89c" strokeWidth={isFirst ? 2 : 1} />;
            })}
            {mousePos && drawingPoints.length > 0 && (() => {
              const last = drawingPoints[drawingPoints.length - 1];
              const dist = Math.sqrt((mousePos.x - last.x) ** 2 + (mousePos.y - last.y) ** 2);
              const mid = r2s((last.x + mousePos.x) / 2, (last.y + mousePos.y) / 2);
              return <text x={mid.x} y={mid.y - 6} textAnchor="middle" fill="#14b89c" fontSize="9" fontWeight="500" opacity={0.7}>{dist.toFixed(2)}m</text>;
            })()}
          </g>
        )}

        {/* Calibration reference points */}
        {mode === "calibrate" && calibrationPoints.map((cp, i) => {
          const s = r2s(cp.px, cp.py);
          const labels = ["A", "B", "C", "D", "E", "F"];
          return (
            <g key={`cal-${i}`}>
              <circle cx={s.x} cy={s.y} r={8} fill="none" stroke="#f59e0b" strokeWidth={2} />
              <line x1={s.x - 10} y1={s.y} x2={s.x + 10} y2={s.y} stroke="#f59e0b" strokeWidth={1} />
              <line x1={s.x} y1={s.y - 10} x2={s.x} y2={s.y + 10} stroke="#f59e0b" strokeWidth={1} />
              <text x={s.x + 12} y={s.y + 4} fill="#f59e0b" fontSize="11" fontWeight="700" className="select-none pointer-events-none">{labels[i] || (i + 1).toString()}</text>
              <text x={s.x + 12} y={s.y + 16} fill="#fbbf24" fontSize="8" opacity={0.7} className="select-none pointer-events-none">({cp.rx.toFixed(1)}, {cp.ry.toFixed(1)})m</text>
            </g>
          );
        })}

        {/* Sensor node markers */}
        {sensorNodes.map((node) => {
          const color = node.status === "online" ? "#14b89c" : node.status === "offline" ? "#ef4444" : "#6b7280";
          const s = r2s(node.x, node.y);
          return (
            <g key={node.id}>
              <g transform={`translate(${s.x}, ${s.y}) rotate(${node.rotation})`}>
                <polygon points="0,-16 -5,-8 5,-8" fill={color} opacity={0.6} />
              </g>
              <circle cx={s.x} cy={s.y} r="9" fill="#1c202d" stroke={color} strokeWidth="2" />
              <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="7" fontWeight="700" className="pointer-events-none select-none">S</text>
              {showLabels && (
                <text x={s.x} y={s.y + 18} textAnchor="middle" dominantBaseline="hanging" fill="#9ca3af" fontSize="9" className="pointer-events-none select-none">{node.name}</text>
              )}
            </g>
          );
        })}

        {/* Live tracking dots */}
        {trackTargets.map((t, i) => {
          const s = r2s(t.x, t.y);
          const color = TRACK_COLORS[i % TRACK_COLORS.length];
          const alpha = t.opacity ?? 1;
          const isStale = t.stale ?? false;
          const isStationary = t.speed < 0.06;
          const staleAgeSec = isStale && t.lastSeen ? Math.round((Date.now() - t.lastSeen) / 1000) : 0;
          return (
            <g key={`track-${t.nodeId ?? "?"}-${t.id}`} opacity={alpha} className="pointer-events-none">
              {isStale ? (
                <>
                  {/* Last known position ghost */}
                  <circle cx={s.x} cy={s.y} r={18} fill="none" stroke={color} strokeWidth={1} strokeDasharray="4 4" opacity={0.35} />
                  <circle cx={s.x} cy={s.y} r={10} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <circle cx={s.x} cy={s.y} r={4} fill={color} fillOpacity={0.3} />
                  {showLabels && (
                    <g className="select-none">
                      <rect x={s.x + 9} y={s.y - 13} width={52} height={20} rx={3} fill="rgba(0,0,0,0.55)" />
                      <text x={s.x + 13} y={s.y - 3} fill={color} fontSize={8} fontWeight="600" opacity={0.7}>T{i + 1} last seen</text>
                      <text x={s.x + 13} y={s.y + 6} fill="#6b7280" fontSize={7}>{staleAgeSec}s ago</text>
                    </g>
                  )}
                </>
              ) : (
                <>
                  {/* Soft glow halo */}
                  <circle cx={s.x} cy={s.y} r={18} fill={color} fillOpacity={0.07} />
                  {/* Outer ring */}
                  <circle cx={s.x} cy={s.y} r={11} fill="none" stroke={color} strokeWidth={1} opacity={0.4} />
                  {/* Main dot */}
                  <circle cx={s.x} cy={s.y} r={6} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />
                  {/* Stationary indicator */}
                  {isStationary && (
                    <circle cx={s.x} cy={s.y} r={2.5} fill="white" fillOpacity={0.7} />
                  )}
                  {showLabels && (
                    <g className="select-none">
                      <rect x={s.x + 11} y={s.y - 14} width={46} height={30} rx={3} fill="rgba(0,0,0,0.5)" />
                      <text x={s.x + 15} y={s.y - 4} fill={color} fontSize={8} fontWeight="600">T{i + 1}</text>
                      <text x={s.x + 15} y={s.y + 6} fill="#9ca3af" fontSize={7}>
                        {isStationary ? "stationary" : `${t.speed.toFixed(1)} m/s`}
                      </text>
                      <text x={s.x + 15} y={s.y + 15} fill="#6b7280" fontSize={6}>
                        {t.x.toFixed(1)}, {t.y.toFixed(1)}
                      </text>
                    </g>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* Out-of-viewport edge indicators */}
        {trackTargets.filter((t) =>
          t.x < -MARGIN || t.x > roomWidth + MARGIN ||
          t.y < -MARGIN || t.y > roomHeight + MARGIN
        ).map((t) => {
          const idx = trackTargets.indexOf(t);
          const color = TRACK_COLORS[idx % TRACK_COLORS.length];
          const cx = Math.max(-MARGIN + 0.15, Math.min(roomWidth + MARGIN - 0.15, t.x));
          const cy = Math.max(-MARGIN + 0.15, Math.min(roomHeight + MARGIN - 0.15, t.y));
          const s = r2s(cx, cy);
          const angle = Math.atan2(t.y - cy, t.x - cx) * 180 / Math.PI;
          return (
            <g key={`oob-${t.nodeId}-${t.id}`} className="pointer-events-none">
              <circle cx={s.x} cy={s.y} r={5} fill={color} opacity={0.6} />
              <g transform={`translate(${s.x}, ${s.y}) rotate(${angle})`}>
                <polygon points="10,0 3,-4 3,4" fill={color} opacity={0.8} />
              </g>
              <text x={s.x} y={s.y - 9} textAnchor="middle" fill={color} fontSize="8" fontWeight="600" opacity={0.7}>T{idx + 1}</text>
            </g>
          );
        })}

        {/* Validate mode: target-in-zone lines */}
        {mode === "validate" && trackTargets.map((t) => {
          const s = r2s(t.x, t.y);
          return zones.filter((z) => z.enabled && triggeredZoneIds.has(z.id)).map((z) => {
            const center = polygonCenter(z.points);
            const sc = r2s(center.x, center.y);
            return (
              <line key={`val-${t.id}-${z.id}`} x1={s.x} y1={s.y} x2={sc.x} y2={sc.y} stroke={z.color} strokeWidth={1} strokeDasharray="4 2" opacity={0.4} className="pointer-events-none" />
            );
          });
        })}

        {/* Empty state */}
        {zones.length === 0 && mode !== "draw" && sensorNodes.length === 0 && (
          <text x={vw / 2} y={vh / 2} textAnchor="middle" dominantBaseline="middle" fill="#4b5563" fontSize="13">
            Click "Draw Zone" to define your first detection zone
          </text>
        )}
      </svg>
    </div>
  );
});

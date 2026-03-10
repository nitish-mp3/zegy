import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useZones, type Zone, type ActionStep } from "../hooks/useZones";
import { useNodes } from "../hooks/useNodes";
import { useDevices } from "../hooks/useDevices";
import { api } from "../api/client";
import { subscribe } from "../api/ws";
import { formatEntityName, pluralize } from "../utils/format";
import {
  computeCalibration,
  identityCalibration,
  serializeCalibration,
  deserializeCalibration,
  type CalibrationPoint,
  type CalibrationState,
  type AffineParams,
} from "../utils/calibration";
import ZoneCanvas, { type EditorMode, type ZonePoint } from "../components/ZoneCanvas";

/* ---- Constants ---- */

const ZONE_COLORS = [
  "#14b89c", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#6366f1",
];

const SERVICES: Record<string, string[]> = {
  light:  ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  fan:    ["turn_on", "turn_off", "toggle"],
  cover:  ["open_cover", "close_cover", "toggle"],
  media_player: ["turn_on", "turn_off", "media_play", "media_pause", "media_stop"],
  scene:  ["turn_on"],
  script: ["turn_on"],
};

function getServicesForEntity(entityId: string): string[] {
  const domain = entityId.split(".")[0];
  return SERVICES[domain] ?? ["turn_on", "turn_off", "toggle"];
}

/* ---- Types ---- */

interface TrackTarget { id: number; x: number; y: number; speed: number }
interface TrackHistoryPoint { id: string; x: number; y: number; ageMs: number }
interface UndoEntry { zones: Zone[]; description: string }

/* ---- Component ---- */

export default function FloorPlan() {
  const { zones, loading: zonesLoading, refresh: refreshZones, create: createZone, update: updateZone, remove: removeZone, setZones } = useZones();
  const { devices } = useDevices();

  /* Canvas state */
  const [mode, setMode] = useState<EditorMode>("view");
  const [drawingPoints, setDrawingPoints] = useState<ZonePoint[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingVertexIdx, setEditingVertexIdx] = useState<number | null>(null);

  /* Room dimensions (meters) */
  const [roomWidth, setRoomWidth] = useState(8);
  const [roomHeight, setRoomHeight] = useState(6);
  const [gridStep, setGridStep] = useState(0.5);
  const [snapEnabled, setSnapEnabled] = useState(true);

  /* Display toggles */
  const [showCoverage, setShowCoverage] = useState(true);
  const [showMotionHistory, setShowMotionHistory] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  /* Live tracking */
  const [trackTargets, setTrackTargets] = useState<TrackTarget[]>([]);
  const [trackHistory, setTrackHistory] = useState<TrackHistoryPoint[]>([]);

  /* Calibration */
  const [calibration, setCalibration] = useState<CalibrationState>(identityCalibration());
  const [calStep, setCalStep] = useState<"idle" | "placing" | "entering" | "done">("idle");
  const [calTempPixel, setCalTempPixel] = useState<{ x: number; y: number } | null>(null);
  const [calTempRoomX, setCalTempRoomX] = useState("");
  const [calTempRoomY, setCalTempRoomY] = useState("");

  /* Zone creation form */
  const [showNewZoneForm, setShowNewZoneForm] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneColor, setNewZoneColor] = useState(ZONE_COLORS[0]);
  const pendingPoints = useRef<ZonePoint[]>([]);

  /* Zone edit panel */
  const [editZone, setEditZone] = useState<Zone | null>(null);
  const [addingAction, setAddingAction] = useState<"enter" | "exit" | null>(null);
  const [newActionEntity, setNewActionEntity] = useState("");
  const [newActionService, setNewActionService] = useState("turn_on");
  const [newActionDelay, setNewActionDelay] = useState(0);
  const [saving, setSaving] = useState(false);

  /* Validate mode */
  const [triggeredZoneIds, setTriggeredZoneIds] = useState<Set<string>>(new Set());

  /* Undo/Redo */
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  /* Side panel tab */
  const [panelTab, setPanelTab] = useState<"zones" | "calibration" | "settings">("zones");

  /* Add-node form */
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  const [addNodeBusy, setAddNodeBusy] = useState(false);

  const { nodes, create: createNode, refresh: refreshNodes, remove: removeNode } = useNodes();

  /* Poll node status */
  useEffect(() => {
    const timer = window.setInterval(refreshNodes, 10000);
    return () => window.clearInterval(timer);
  }, [refreshNodes]);

  async function handleAddNode() {
    const trimmed = newNodeName.trim();
    if (!trimmed) return;
    const topic = `zegy/${trimmed.toLowerCase().replace(/\s+/g, "-")}`;
    if (nodes.some((n) => n.mqttTopic === topic)) {
      alert(`A node with topic "${topic}" already exists.`);
      return;
    }
    setAddNodeBusy(true);
    try {
      await createNode({
        name: trimmed,
        mqttTopic: topic,
        x: roomWidth / 2, y: roomHeight / 2, rotation: 0, scale: 1,
      });
      setNewNodeName("");
      setShowAddNode(false);
      refreshNodes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add node";
      alert(msg);
    } finally {
      setAddNodeBusy(false);
    }
  }

  async function handleDeleteNode(id: string) {
    try {
      await removeNode(id);
    } catch {
      alert("Failed to delete node");
    }
  }

  /* Mobile sidebar */
  const [showMobileSide, setShowMobileSide] = useState(false);

  /* ---- WebSocket subscription ---- */
  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type === "track_update") {
        const targets = (data.targets ?? []) as TrackTarget[];
        setTrackTargets(targets);
        if (showMotionHistory && targets.length > 0) {
          setTrackHistory((prev) => [
            ...targets.map((t) => ({ id: `${t.id}-${Date.now()}`, x: t.x, y: t.y, ageMs: 0 })),
            ...prev,
          ].slice(0, 500));
        }
      }
      if (data.type === "zone_event") {
        const zoneId = data.zoneId as string;
        const evtType = data.eventType as string;  // backend sends eventType: "enter"|"exit"
        if (mode === "validate") {
          setTriggeredZoneIds((prev) => {
            const next = new Set(prev);
            if (evtType === "enter") next.add(zoneId);
            else next.delete(zoneId);
            return next;
          });
        }
        refreshZones();
      }
    });
    return unsub;
  }, [refreshZones, showMotionHistory, mode]);

  /* Motion history aging */
  useEffect(() => {
    if (!showMotionHistory) { setTrackHistory([]); return; }
    const timer = window.setInterval(() => {
      setTrackHistory((prev) =>
        prev.map((p) => ({ ...p, ageMs: p.ageMs + 1000 })).filter((p) => p.ageMs < 12000),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [showMotionHistory]);

  /* Sync editZone from selection */
  useEffect(() => {
    if (selectedZoneId) {
      const z = zones.find((z) => z.id === selectedZoneId);
      setEditZone(z ? { ...z } : null);
    } else {
      setEditZone(null);
    }
  }, [selectedZoneId, zones]);

  /* Load saved calibration */
  useEffect(() => {
    try {
      const saved = localStorage.getItem("zegy-calibration");
      if (saved) setCalibration(deserializeCalibration(JSON.parse(saved)));
      const dims = localStorage.getItem("zegy-room-dims");
      if (dims) {
        const d = JSON.parse(dims);
        if (d.w) setRoomWidth(d.w);
        if (d.h) setRoomHeight(d.h);
      }
    } catch { /* ignore */ }
  }, []);

  /* Persist calibration */
  useEffect(() => {
    try {
      localStorage.setItem("zegy-calibration", JSON.stringify(serializeCalibration(calibration)));
    } catch { /* ignore */ }
  }, [calibration]);

  useEffect(() => {
    try {
      localStorage.setItem("zegy-room-dims", JSON.stringify({ w: roomWidth, h: roomHeight }));
    } catch { /* ignore */ }
  }, [roomWidth, roomHeight]);

  /* ---- Undo/Redo helpers ---- */
  const pushUndo = useCallback((desc: string) => {
    setUndoStack((prev) => [...prev.slice(-30), { zones: JSON.parse(JSON.stringify(zones)), description: desc }]);
    setRedoStack([]);
  }, [zones]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, { zones: JSON.parse(JSON.stringify(zones)), description: entry.description }]);
    setUndoStack((prev) => prev.slice(0, -1));
    setZones(entry.zones);
  }, [undoStack, zones, setZones]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, { zones: JSON.parse(JSON.stringify(zones)), description: entry.description }]);
    setRedoStack((prev) => prev.slice(0, -1));
    setZones(entry.zones);
  }, [redoStack, zones, setZones]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.ctrlKey && e.key === "z" && e.shiftKey) { e.preventDefault(); handleRedo(); }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); handleRedo(); }
      if (e.key === "Escape") {
        if (mode === "draw") { setMode("view"); setDrawingPoints([]); }
        if (mode === "calibrate") { setMode("view"); setCalStep("idle"); }
        if (mode === "validate") { setMode("view"); setTriggeredZoneIds(new Set()); }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleUndo, handleRedo, mode]);

  /* ---- Controllable entities ---- */
  const controllableEntities = useMemo(() => {
    const results: { entityId: string; name: string; domain: string }[] = [];
    for (const d of devices) {
      for (const s of d.sensors) {
        const domain = s.entityId.split(".")[0];
        if (SERVICES[domain]) {
          results.push({ entityId: s.entityId, name: formatEntityName(s.entityId), domain });
        }
      }
    }
    return results;
  }, [devices]);

  /* ---- Canvas callbacks ---- */
  const handleCanvasClick = useCallback(
    (rx: number, ry: number) => {
      if (mode !== "draw") return;
      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        const dist = Math.sqrt((rx - first.x) ** 2 + (ry - first.y) ** 2);
        if (dist < 0.3) {
          pendingPoints.current = [...drawingPoints];
          setDrawingPoints([]);
          setMode("view");
          setNewZoneName("");
          setNewZoneColor(ZONE_COLORS[zones.length % ZONE_COLORS.length]);
          setShowNewZoneForm(true);
          return;
        }
      }
      setDrawingPoints((prev) => [...prev, { x: Number(rx.toFixed(3)), y: Number(ry.toFixed(3)) }]);
    },
    [mode, drawingPoints, zones.length],
  );

  const handleCanvasMouseMove = useCallback((_rx: number, _ry: number) => {
    // mousePos tracked internally by ZoneCanvas
  }, []);

  const handleZoneClick = useCallback((id: string) => {
    if (mode === "view" || mode === "edit") {
      setSelectedZoneId(id === selectedZoneId ? null : id);
    }
  }, [mode, selectedZoneId]);

  const handleVertexDragStart = useCallback((zoneId: string, idx: number) => {
    setSelectedZoneId(zoneId);
    setEditingVertexIdx(idx);
    pushUndo("Move vertex");
  }, [pushUndo]);

  const handleVertexDrag = useCallback((rx: number, ry: number) => {
    if (editingVertexIdx === null || !selectedZoneId) return;
    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== selectedZoneId) return z;
        const pts = [...z.points];
        pts[editingVertexIdx] = { x: Number(rx.toFixed(3)), y: Number(ry.toFixed(3)) };
        return { ...z, points: pts };
      }),
    );
  }, [editingVertexIdx, selectedZoneId, setZones]);

  const handleVertexDragEnd = useCallback(() => {
    setEditingVertexIdx(null);
    // Save the moved zone to backend
    if (selectedZoneId) {
      const z = zones.find((z) => z.id === selectedZoneId);
      if (z) updateZone(z.id, z).catch(() => {});
    }
  }, [selectedZoneId, zones, updateZone]);

  const handleCalibrationPointClick = useCallback((px: number, py: number) => {
    if (calStep === "placing") {
      setCalTempPixel({ x: px, y: py });
      setCalStep("entering");
      setCalTempRoomX("");
      setCalTempRoomY("");
    }
  }, [calStep]);

  /* ---- Zone CRUD ---- */
  const handleCreateZone = async () => {
    if (!newZoneName.trim() || pendingPoints.current.length < 3) return;
    setSaving(true);
    pushUndo("Create zone");
    try {
      const zone = await createZone({
        name: newZoneName.trim(),
        color: newZoneColor,
        points: pendingPoints.current,
        enabled: true,
        dwellTime: 500,
        exitDelay: 30000,
        onEnter: [],
        onExit: [],
      });
      setSelectedZoneId(zone.id);
      setShowNewZoneForm(false);
      pendingPoints.current = [];
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleSaveZone = async () => {
    if (!editZone) return;
    setSaving(true);
    try { await updateZone(editZone.id, editZone); }
    catch { alert("Failed to save zone. Please try again."); }
    finally { setSaving(false); }
  };

  const handleDeleteZone = async () => {
    if (!editZone) return;
    setSaving(true);
    pushUndo("Delete zone");
    try { await removeZone(editZone.id); setSelectedZoneId(null); }
    catch { alert("Failed to delete zone. Please try again."); }
    finally { setSaving(false); }
  };

  const handleAddAction = () => {
    if (!editZone || !addingAction || !newActionEntity) return;
    const action: ActionStep = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entityId: newActionEntity,
      service: newActionService,
      delay: newActionDelay,
    };
    const updated = { ...editZone };
    if (addingAction === "enter") { updated.onEnter = [...updated.onEnter, action]; }
    else { updated.onExit = [...updated.onExit, action]; }
    setEditZone(updated);
    setAddingAction(null);
    setNewActionEntity("");
    setNewActionService("turn_on");
    setNewActionDelay(0);
  };

  const handleRemoveAction = (type: "enter" | "exit", actionId: string) => {
    if (!editZone) return;
    const updated = { ...editZone };
    if (type === "enter") { updated.onEnter = updated.onEnter.filter((a) => a.id !== actionId); }
    else { updated.onExit = updated.onExit.filter((a) => a.id !== actionId); }
    setEditZone(updated);
  };

  /* ---- Calibration ---- */
  const handleConfirmCalPoint = () => {
    if (!calTempPixel) return;
    const rx = parseFloat(calTempRoomX);
    const ry = parseFloat(calTempRoomY);
    if (isNaN(rx) || isNaN(ry)) return;
    const pt: CalibrationPoint = { px: calTempPixel.x, py: calTempPixel.y, rx, ry };
    const newPoints = [...calibration.points, pt];
    setCalibration(computeCalibration(newPoints));
    setCalStep("placing");
    setCalTempPixel(null);
  };

  const handleRemoveCalPoint = (i: number) => {
    const newPoints = calibration.points.filter((_, idx) => idx !== i);
    setCalibration(computeCalibration(newPoints));
  };

  const handleResetCalibration = () => {
    setCalibration(identityCalibration());
    setCalStep("idle");
    setMode("view");
  };

  /* ---- Export/Import ---- */
  const handleExport = () => {
    const data = {
      version: 1,
      roomWidth,
      roomHeight,
      calibration: serializeCalibration(calibration),
      zones: zones.map((z) => ({ name: z.name, color: z.color, points: z.points, enabled: z.enabled, dwellTime: z.dwellTime, exitDelay: z.exitDelay, onEnter: z.onEnter, onExit: z.onExit })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zegy-zones.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.roomWidth) setRoomWidth(data.roomWidth);
        if (data.roomHeight) setRoomHeight(data.roomHeight);
        if (data.calibration) setCalibration(deserializeCalibration(data.calibration));
        if (Array.isArray(data.zones)) {
          pushUndo("Import zones");
          // Create all zones on backend
          for (const z of data.zones) {
            await createZone({
              name: z.name ?? "Imported",
              color: z.color ?? ZONE_COLORS[0],
              points: z.points ?? [],
              enabled: z.enabled ?? true,
              dwellTime: z.dwellTime ?? 500,
              exitDelay: z.exitDelay ?? 30000,
              onEnter: z.onEnter ?? [],
              onExit: z.onExit ?? [],
            });
          }
        }
      } catch { /* ignore invalid file */ }
    };
    input.click();
  };

  /* ---- Derived ---- */
  const sensorNodeMarkers = useMemo(
    () => nodes.map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, rotation: n.rotation, status: n.status })),
    [nodes],
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!editZone || !selectedZoneId) return false;
    const original = zones.find((z) => z.id === selectedZoneId);
    if (!original) return false;
    return JSON.stringify(original) !== JSON.stringify({ ...editZone, state: original.state });
  }, [editZone, selectedZoneId, zones]);

  const calPointLabels = ["A", "B", "C", "D", "E", "F"];

  /* ---- Render ---- */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Zones</h1>
          <p className="page-subtitle">Draw detection zones in room coordinates, attach device actions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === "draw" ? (
            <>
              <span className="badge bg-zegy-500/15 text-zegy-400 text-xs">
                {drawingPoints.length} pts - click to place, close near first
              </span>
              <button onClick={() => { setMode("view"); setDrawingPoints([]); }} className="btn-secondary text-sm">Cancel</button>
            </>
          ) : mode === "validate" ? (
            <>
              <span className="badge bg-blue-500/15 text-blue-400 text-xs">Validate Mode</span>
              <button onClick={() => { setMode("view"); setTriggeredZoneIds(new Set()); }} className="btn-secondary text-sm">Exit</button>
            </>
          ) : mode === "calibrate" ? (
            <>
              <span className="badge bg-amber-500/15 text-amber-400 text-xs">Calibration Mode</span>
              <button onClick={() => { setMode("view"); setCalStep("idle"); }} className="btn-secondary text-sm">Done</button>
            </>
          ) : (
            <>
              <button onClick={() => setMode("draw")} className="btn-primary flex items-center gap-2 text-sm">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
                Draw Zone
              </button>
              <button onClick={() => { setMode("validate"); setTriggeredZoneIds(new Set()); }} className="btn-secondary text-sm">Validate</button>
              {/* Mobile side panel toggle */}
              <button onClick={() => setShowMobileSide(true)} className="btn-secondary text-sm lg:hidden">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        {/* View toggles */}
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-surface-overlay p-0.5">
          {([["Grid", showGrid, setShowGrid], ["Labels", showLabels, setShowLabels], ["Coverage", showCoverage, setShowCoverage], ["Trail", showMotionHistory, setShowMotionHistory]] as [string, boolean, (v: boolean) => void][]).map(([label, on, toggle]) => (
            <button key={label as string} onClick={() => (toggle as (v: boolean) => void)(!on)} className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "bg-zegy-600/20 text-zegy-300" : "text-gray-500 hover:text-gray-200"}`}>
              {label as string}
            </button>
          ))}
        </div>

        {/* Snap toggle */}
        <button onClick={() => setSnapEnabled(!snapEnabled)} className={`rounded-xl border px-2.5 py-1 text-[11px] transition-colors ${snapEnabled ? "border-zegy-700/50 bg-zegy-950/40 text-zegy-300" : "border-white/[0.08] bg-surface-overlay text-gray-500"}`}>
          Snap {snapEnabled ? "On" : "Off"}
        </button>

        {/* Undo/Redo */}
        <div className="flex gap-1 ml-auto">
          <button onClick={handleUndo} disabled={undoStack.length === 0} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30" title="Undo (Ctrl+Z)">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>
          </button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30" title="Redo (Ctrl+Shift+Z)">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg>
          </button>
        </div>

        {/* Export/Import */}
        <button onClick={handleExport} className="btn-secondary px-2.5 py-1 text-[11px]">Export</button>
        <button onClick={handleImport} className="btn-secondary px-2.5 py-1 text-[11px]">Import</button>
      </div>

      {/* Live status bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${trackTargets.length > 0 ? "bg-amber-400 animate-pulse" : "bg-gray-600"}`} />
          {pluralize(trackTargets.length, "live target")}
        </div>
        <span>{pluralize(zones.length, "zone")}</span>
        <span>{pluralize(sensorNodeMarkers.filter((n) => n.status === "online").length, "node")} online</span>
        {calibration.affine && calibration.points.length >= 3 && (
          <span className="text-zegy-400">Cal: {calibration.error.toFixed(3)}m RMS</span>
        )}
        {mode === "validate" && triggeredZoneIds.size > 0 && (
          <span className="text-blue-400">{triggeredZoneIds.size} zone{triggeredZoneIds.size !== 1 ? "s" : ""} triggered</span>
        )}
      </div>

      {/* Main layout */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <ZoneCanvas
            roomWidth={roomWidth}
            roomHeight={roomHeight}
            gridStep={gridStep}
            snapEnabled={snapEnabled}
            affine={calibration.affine}
            inverse={calibration.inverse}
            calibrationPoints={calibration.points}
            zones={zones}
            sensorNodes={sensorNodeMarkers}
            trackTargets={trackTargets}
            trackHistory={trackHistory}
            mode={mode}
            selectedZoneId={selectedZoneId}
            drawingPoints={drawingPoints}
            editingVertexIdx={editingVertexIdx}
            showCoverage={showCoverage}
            showMotionHistory={showMotionHistory}
            showGrid={showGrid}
            showLabels={showLabels}
            triggeredZoneIds={triggeredZoneIds}
            onCanvasClick={handleCanvasClick}
            onCanvasMouseMove={handleCanvasMouseMove}
            onZoneClick={handleZoneClick}
            onVertexDragStart={handleVertexDragStart}
            onVertexDrag={handleVertexDrag}
            onVertexDragEnd={handleVertexDragEnd}
            onCalibrationPointClick={handleCalibrationPointClick}
          />
        </div>

        {/* Side Panel - Desktop */}
        <aside className="hidden lg:block w-80 shrink-0 space-y-3">
          <SidePanel />
        </aside>

        {/* Side Panel - Mobile overlay */}
        {showMobileSide && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMobileSide(false)} />
            <aside className="absolute inset-y-0 right-0 w-80 max-w-[90vw] overflow-y-auto bg-surface-raised p-4 shadow-2xl animate-fade-in space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-200">Panel</h3>
                <button onClick={() => setShowMobileSide(false)} className="text-gray-500 hover:text-gray-200">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <SidePanel />
            </aside>
          </div>
        )}
      </div>
    </div>
  );

  /* ---- Side Panel Content ---- */
  function SidePanel() {
    return (
      <>
        {/* Tab bar */}
        <div className="flex rounded-xl border border-white/[0.08] bg-surface-overlay p-0.5">
          {(["zones", "calibration", "settings"] as const).map((tab) => (
            <button key={tab} onClick={() => setPanelTab(tab)} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${panelTab === tab ? "bg-zegy-600/20 text-zegy-300" : "text-gray-500 hover:text-gray-200"}`}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {panelTab === "zones" && <ZonesPanel />}
        {panelTab === "calibration" && <CalibrationPanel />}
        {panelTab === "settings" && <SettingsPanel />}
      </>
    );
  }

  /* ---- Zones Panel ---- */
  function ZonesPanel() {
    return (
      <>
        {/* New zone form */}
        {showNewZoneForm && (
          <div className="card p-4 space-y-3 animate-fade-in">
            <h3 className="text-sm font-semibold text-gray-200">New Zone</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input type="text" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} placeholder="e.g. Living Room" className="input" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCreateZone()} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Color</label>
              <div className="flex gap-1.5 flex-wrap">
                {ZONE_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewZoneColor(c)} className={`h-6 w-6 rounded-lg transition-all ${newZoneColor === c ? "ring-2 ring-white/30 scale-110" : "hover:scale-105"}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div className="text-[10px] text-gray-600">{pendingPoints.current.length} vertices</div>
            <div className="flex gap-2">
              <button onClick={handleCreateZone} disabled={!newZoneName.trim() || saving} className="btn-primary flex-1 text-sm">{saving ? "Creating..." : "Create Zone"}</button>
              <button onClick={() => { setShowNewZoneForm(false); pendingPoints.current = []; }} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Zone detail panel */}
        {editZone && !showNewZoneForm && (
          <div className="card p-4 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: editZone.color }} />
                <input type="text" value={editZone.name} onChange={(e) => setEditZone({ ...editZone, name: e.target.value })} className="bg-transparent text-sm font-semibold text-gray-100 border-none outline-none focus:ring-0 w-full" />
              </div>
              <button onClick={() => setSelectedZoneId(null)} className="text-gray-600 hover:text-gray-300 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${editZone.state?.occupied ? "bg-zegy-400" : "bg-gray-600"}`} />
              <span className="text-xs text-gray-500">{editZone.state?.occupied ? `Active - ${editZone.state.targetCount} target${editZone.state.targetCount !== 1 ? "s" : ""}` : "Idle"}</span>
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">Color</label>
              <div className="flex gap-1.5 flex-wrap">
                {ZONE_COLORS.map((c) => (
                  <button key={c} onClick={() => setEditZone({ ...editZone, color: c })} className={`h-5 w-5 rounded-md transition-all ${editZone.color === c ? "ring-2 ring-white/30 scale-110" : "hover:scale-105"}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Enabled</span>
              <button onClick={() => setEditZone({ ...editZone, enabled: !editZone.enabled })} className={`relative h-5 w-9 rounded-full transition-colors ${editZone.enabled ? "bg-zegy-600" : "bg-gray-700"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${editZone.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Timing */}
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-600">Dwell Time</label>
                  <span className="text-xs tabular-nums text-gray-400">{(editZone.dwellTime / 1000).toFixed(1)}s</span>
                </div>
                <input type="range" min={0} max={10000} step={100} value={editZone.dwellTime} onChange={(e) => setEditZone({ ...editZone, dwellTime: Number(e.target.value) })} className="w-full accent-zegy-500" />
                <p className="text-[10px] text-gray-700 mt-0.5">How long a target must stay before triggering</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-600">Exit Delay</label>
                  <span className="text-xs tabular-nums text-gray-400">{(editZone.exitDelay / 1000).toFixed(0)}s</span>
                </div>
                <input type="range" min={0} max={300000} step={1000} value={editZone.exitDelay} onChange={(e) => setEditZone({ ...editZone, exitDelay: Number(e.target.value) })} className="w-full accent-zegy-500" />
                <p className="text-[10px] text-gray-700 mt-0.5">Delay before exit actions trigger after target leaves</p>
              </div>
            </div>

            <div className="border-t border-white/[0.06]" />

            {/* On Enter Actions */}
            <ActionSection title="On Enter" actions={editZone.onEnter} type="enter" />
            {/* On Exit Actions */}
            <ActionSection title="On Exit" actions={editZone.onExit} type="exit" />

            {/* Add Action Form */}
            {addingAction && (
              <div className="rounded-xl bg-white/[0.03] p-3 space-y-2.5 animate-fade-in">
                <p className="text-xs font-medium text-gray-400">New {addingAction === "enter" ? "Enter" : "Exit"} Action</p>
                <div>
                  <label className="block text-[10px] text-gray-600 mb-1">Entity</label>
                  <select value={newActionEntity} onChange={(e) => { setNewActionEntity(e.target.value); const svcs = getServicesForEntity(e.target.value); if (svcs.length > 0 && !svcs.includes(newActionService)) setNewActionService(svcs[0]); }} className="input text-xs py-2">
                    <option value="">Select entity...</option>
                    {controllableEntities.map((e) => <option key={e.entityId} value={e.entityId}>{e.name} ({e.domain})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-600 mb-1">Service</label>
                  <select value={newActionService} onChange={(e) => setNewActionService(e.target.value)} className="input text-xs py-2">
                    {(newActionEntity ? getServicesForEntity(newActionEntity) : ["turn_on", "turn_off", "toggle"]).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-gray-600">Delay</label>
                    <span className="text-[10px] tabular-nums text-gray-500">{(newActionDelay / 1000).toFixed(1)}s</span>
                  </div>
                  <input type="range" min={0} max={60000} step={500} value={newActionDelay} onChange={(e) => setNewActionDelay(Number(e.target.value))} className="w-full accent-zegy-500" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddAction} disabled={!newActionEntity} className="btn-primary text-xs flex-1 py-2">Add</button>
                  <button onClick={() => setAddingAction(null)} className="btn-secondary text-xs py-2">Cancel</button>
                </div>
              </div>
            )}

            {/* Vertices info */}
            <div className="text-[10px] text-gray-700">{editZone.points.length} vertices - drag to move</div>

            {/* Save / Delete */}
            <div className="flex gap-2">
              <button onClick={handleSaveZone} disabled={!hasUnsavedChanges || saving} className="btn-primary flex-1 text-sm disabled:opacity-30">{saving ? "Saving..." : hasUnsavedChanges ? "Save Changes" : "Saved"}</button>
              <button onClick={handleDeleteZone} disabled={saving} className="rounded-xl border border-rose-900/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-400 transition-all hover:bg-rose-950/40">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* Zone list (when nothing selected) */}
        {!selectedZoneId && !showNewZoneForm && (
          <div className="card p-3 animate-fade-in">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600">Zones ({zones.length})</h3>
            {zones.length === 0 ? (
              <p className="text-xs text-gray-700">No zones yet. Click "Draw Zone" to create one.</p>
            ) : (
              <div className="space-y-1">
                {zones.map((z) => (
                  <button key={z.id} onClick={() => setSelectedZoneId(z.id)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/[0.04]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: z.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">{z.name}</p>
                      <p className="text-[10px] text-gray-600">
                        {z.onEnter.length + z.onExit.length} action{z.onEnter.length + z.onExit.length !== 1 ? "s" : ""}
                        {z.state?.occupied && <span className="ml-1 text-zegy-400">active</span>}
                      </p>
                    </div>
                    {!z.enabled && <span className="text-[10px] text-gray-700">off</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sensor Nodes */}
        {!selectedZoneId && !showNewZoneForm && (
          <div className="card p-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-gray-600">Sensor Nodes {nodes.length > 0 && `(${nodes.length})`}</h3>
              <button onClick={() => setShowAddNode((v) => !v)} className="text-xs text-zegy-400 hover:text-zegy-300 transition-colors">+ Add</button>
            </div>

            {showAddNode && (
              <div className="mb-2 flex gap-1.5">
                <input
                  autoFocus
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddNode(); if (e.key === "Escape") setShowAddNode(false); }}
                  placeholder="e.g. studyroom"
                  className="flex-1 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none focus:ring-1 focus:ring-zegy-500"
                />
                <button onClick={handleAddNode} disabled={addNodeBusy || !newNodeName.trim()} className="rounded-lg bg-zegy-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {addNodeBusy ? "…" : "Add"}
                </button>
              </div>
            )}

            {nodes.length === 0 && !showAddNode && (
              <p className="text-[11px] text-gray-600">No nodes yet. Click + Add and enter your node ID (e.g. <span className="text-gray-400">studyroom</span>).</p>
            )}

            {nodes.length > 0 && (
              <div className="space-y-1">
                {nodes.map((n) => (
                  <div key={n.id} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs">
                    <span className={`h-2 w-2 rounded-full ${n.status === "online" ? "bg-zegy-400" : n.status === "offline" ? "bg-rose-400" : "bg-gray-600"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 truncate">{n.name}</p>
                      <p className="text-[10px] text-gray-600">{n.status}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteNode(n.id)}
                      className="text-gray-700 hover:text-rose-400 transition-colors p-0.5"
                      title="Delete node"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Help card */}
        {!selectedZoneId && !showNewZoneForm && (
          <div className="card p-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-600">How To</h3>
            <div className="space-y-1.5 text-[11px] text-gray-500">
              <p>1. Set room dimensions in Settings tab.</p>
              <p>2. Calibrate pixel-to-meter mapping if needed.</p>
              <p>3. Click "Draw Zone" and place polygon vertices.</p>
              <p>4. Click near the first point to close the polygon.</p>
              <p>5. Name and save the zone, then add actions.</p>
              <p>6. Use "Validate" to test live zone triggering.</p>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ---- Action Section ---- */
  function ActionSection({ title, actions, type }: { title: string; actions: ActionStep[]; type: "enter" | "exit" }) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</h4>
          <button onClick={() => setAddingAction(type)} className="text-xs text-zegy-400 hover:text-zegy-300 transition-colors">+ Add</button>
        </div>
        {actions.length === 0 ? (
          <p className="text-[11px] text-gray-700">No actions configured</p>
        ) : (
          <div className="space-y-1">
            {actions.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs text-gray-300 truncate">{formatEntityName(a.entityId)}</p>
                  <p className="text-[10px] text-gray-600">{a.service}{a.delay > 0 ? ` - ${(a.delay / 1000).toFixed(1)}s delay` : ""}</p>
                </div>
                <button onClick={() => handleRemoveAction(type, a.id)} className="ml-2 text-gray-700 hover:text-rose-400 transition-colors">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ---- Calibration Panel ---- */
  function CalibrationPanel() {
    return (
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Calibration</h3>
          <p className="text-[11px] text-gray-500">
            Map canvas positions to real-world room coordinates (meters).
            Place at least 3 reference points for an affine transform.
          </p>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${calibration.affine && calibration.points.length >= 3 ? "bg-zegy-400" : "bg-amber-400"}`} />
            <span className="text-xs text-gray-400">
              {calibration.points.length >= 3 ? `Calibrated (${calibration.error.toFixed(3)}m RMS)` : `${calibration.points.length}/3 points placed`}
            </span>
          </div>

          {/* Start/resume button */}
          {calStep === "idle" && (
            <button onClick={() => { setMode("calibrate"); setCalStep("placing"); }} className="btn-primary w-full text-sm">
              {calibration.points.length > 0 ? "Add More Points" : "Start Calibration"}
            </button>
          )}

          {/* Placing instruction */}
          {calStep === "placing" && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs text-amber-300">Click on the canvas to place reference point {calPointLabels[calibration.points.length] || calibration.points.length + 1}.</p>
            </div>
          )}

          {/* Enter room coordinates */}
          {calStep === "entering" && calTempPixel && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 space-y-2">
              <p className="text-xs text-amber-300">
                Point {calPointLabels[calibration.points.length] || calibration.points.length + 1} placed at ({calTempPixel.x.toFixed(2)}, {calTempPixel.y.toFixed(2)}).
              </p>
              <p className="text-[10px] text-amber-300/70">Enter the real-world room coordinate in meters:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">X (m)</label>
                  <input type="number" step="0.01" value={calTempRoomX} onChange={(e) => setCalTempRoomX(e.target.value)} className="input text-xs py-1.5" autoFocus placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Y (m)</label>
                  <input type="number" step="0.01" value={calTempRoomY} onChange={(e) => setCalTempRoomY(e.target.value)} className="input text-xs py-1.5" placeholder="0.00" onKeyDown={(e) => e.key === "Enter" && handleConfirmCalPoint()} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirmCalPoint} disabled={!calTempRoomX || !calTempRoomY} className="btn-primary flex-1 text-xs py-1.5">Confirm</button>
                <button onClick={() => { setCalStep("placing"); setCalTempPixel(null); }} className="btn-secondary text-xs py-1.5">Cancel</button>
              </div>
            </div>
          )}

          {/* Point list */}
          {calibration.points.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">Reference Points</p>
              {calibration.points.map((cp, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs">
                  <div>
                    <span className="font-semibold text-amber-300 mr-2">{calPointLabels[i] || i + 1}</span>
                    <span className="text-gray-400">({cp.px.toFixed(1)}, {cp.py.toFixed(1)})</span>
                    <span className="text-gray-600 mx-1">&rarr;</span>
                    <span className="text-gray-300">({cp.rx.toFixed(2)}, {cp.ry.toFixed(2)})m</span>
                  </div>
                  <button onClick={() => handleRemoveCalPoint(i)} className="text-gray-700 hover:text-rose-400 transition-colors">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Affine matrix display */}
          {calibration.affine && calibration.points.length >= 3 && (
            <div className="rounded-lg bg-white/[0.02] p-2.5 text-[10px] font-mono text-gray-500 space-y-0.5">
              <p>Affine Transform:</p>
              <p>[{calibration.affine.m00.toFixed(4)}, {calibration.affine.m01.toFixed(4)}, {calibration.affine.tx.toFixed(4)}]</p>
              <p>[{calibration.affine.m10.toFixed(4)}, {calibration.affine.m11.toFixed(4)}, {calibration.affine.ty.toFixed(4)}]</p>
            </div>
          )}

          {/* Reset */}
          {calibration.points.length > 0 && (
            <button onClick={handleResetCalibration} className="text-xs text-rose-400/70 hover:text-rose-400 transition-colors">Reset Calibration</button>
          )}
        </div>
      </div>
    );
  }

  /* ---- Settings Panel ---- */
  function SettingsPanel() {
    return (
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Room Dimensions</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">Width (m)</label>
              <input type="number" min={1} max={50} step={0.5} value={roomWidth} onChange={(e) => setRoomWidth(Number(e.target.value) || 8)} className="input text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Height (m)</label>
              <input type="number" min={1} max={50} step={0.5} value={roomHeight} onChange={(e) => setRoomHeight(Number(e.target.value) || 6)} className="input text-sm" />
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Grid</h3>
          <div>
            <label className="text-xs text-gray-500">Grid Step (m)</label>
            <select value={gridStep} onChange={(e) => setGridStep(Number(e.target.value))} className="input text-sm">
              <option value={0.1}>0.1m</option>
              <option value={0.25}>0.25m</option>
              <option value={0.5}>0.5m</option>
              <option value={1}>1m</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Snap to Grid</span>
            <button onClick={() => setSnapEnabled(!snapEnabled)} className={`relative h-5 w-9 rounded-full transition-colors ${snapEnabled ? "bg-zegy-600" : "bg-gray-700"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${snapEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">Data</h3>
          <div className="flex gap-2">
            <button onClick={handleExport} className="btn-secondary flex-1 text-sm">Export JSON</button>
            <button onClick={handleImport} className="btn-secondary flex-1 text-sm">Import JSON</button>
          </div>
        </div>

        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-200">Keyboard Shortcuts</h3>
          <div className="text-[11px] text-gray-500 space-y-1">
            <p><span className="text-gray-400">Ctrl+Z</span> Undo</p>
            <p><span className="text-gray-400">Ctrl+Shift+Z</span> Redo</p>
            <p><span className="text-gray-400">Esc</span> Cancel current mode</p>
          </div>
        </div>
      </div>
    );
  }
}

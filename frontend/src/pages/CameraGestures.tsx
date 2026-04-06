import { useState, useEffect, useRef, useCallback } from "react";
import { useCameras } from "../hooks/useCameras";
import { useHandDetection } from "../hooks/useHandDetection";
import { api } from "../api/client";
import type {
  CameraConfig,
  CameraGroup,
  CameraGestureBinding,
  CameraGestureType,
  CameraCalibration,
} from "../api/client";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card bg-surface-raised p-5 ${className}`}>{children}</div>;
}

function Btn({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
        ? "btn-secondary"
        : variant === "danger"
          ? "bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-xl font-medium transition-colors"
          : "btn-ghost";
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button className={`${base} ${sz} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-400 mb-1.5">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input w-full ${props.className ?? ""}`} />;
}

function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input w-full appearance-none ${className}`}
    >
      {children}
    </select>
  );
}

function GestureIcon({ gesture, size = 24 }: { gesture: CameraGestureType; size?: number }) {
  if (gesture === "palm") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3.15M10.05 4.575a1.575 1.575 0 113.15 0v3.15M10.05 4.575V7.725m3.15-3.15a1.575 1.575 0 113.15 0v3.15m-3.15-3.15V7.725m3.15-3.15v2.576a3.159 3.159 0 01.895-.045c.858.107 1.543.85 1.555 1.715v4.43a6 6 0 01-6 6h-1.5a6 6 0 01-6-6V9.15a1.575 1.575 0 013.15 0v1.575M6.9 7.725V4.575a1.575 1.575 0 10-3.15 0v6.3" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function AddCameraModal({
  open,
  groups,
  onClose,
  onSave,
}: {
  open: boolean;
  groups: CameraGroup[];
  onClose: () => void;
  onSave: (data: { name: string; url: string; snapshotUrl: string; username: string; password: string; groupId: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [snapshotUrl, setSnapshotUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState("");

  if (!open) return null;

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    onSave({ name: name.trim(), url: url.trim(), snapshotUrl: snapshotUrl.trim(), username, password, groupId: groupId || null });
    setName("");
    setUrl("");
    setSnapshotUrl("");
    setUsername("");
    setPassword("");
    setGroupId("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-raised rounded-2xl p-6 shadow-2xl">
        <h3 className="section-title mb-4">Add Camera</h3>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Living Room Camera" />
          </div>
          <div>
            <Label>Stream URL (MJPEG)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.100/mjpeg" />
          </div>
          <div>
            <Label>Snapshot URL (optional)</Label>
            <Input value={snapshotUrl} onChange={(e) => setSnapshotUrl(e.target.value)} placeholder="http://192.168.1.100/snapshot" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          {groups.length > 0 && (
            <div>
              <Label>Group</Label>
              <Select value={groupId} onChange={setGroupId}>
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave} disabled={!name.trim() || !url.trim()}>Add Camera</Btn>
        </div>
      </div>
    </div>
  );
}

function GestureBindingEditor({
  gestures,
  onChange,
}: {
  gestures: CameraGestureBinding[];
  onChange: (gestures: CameraGestureBinding[]) => void;
}) {
  const addBinding = (gesture: CameraGestureType) => {
    const binding: CameraGestureBinding = {
      id: `cgb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      gesture,
      name: gesture === "palm" ? "Palm Action" : "Fist Action",
      holdTime: 800,
      cooldown: 3000,
      actions: [],
      enabled: true,
    };
    onChange([...gestures, binding]);
  };

  const updateBinding = (id: string, updates: Partial<CameraGestureBinding>) => {
    onChange(gestures.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const removeBinding = (id: string) => {
    onChange(gestures.filter((g) => g.id !== id));
  };

  const updateAction = (bindingId: string, actionIdx: number, field: string, value: string | number) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        const actions = [...g.actions];
        actions[actionIdx] = { ...actions[actionIdx], [field]: value };
        return { ...g, actions };
      }),
    );
  };

  const addAction = (bindingId: string) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        return {
          ...g,
          actions: [
            ...g.actions,
            {
              id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              entityId: "",
              service: "",
              delay: 0,
            },
          ],
        };
      }),
    );
  };

  const removeAction = (bindingId: string, actionIdx: number) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        const actions = g.actions.filter((_, i) => i !== actionIdx);
        return { ...g, actions };
      }),
    );
  };

  return (
    <div className="space-y-3">
      {gestures.map((binding) => (
        <div key={binding.id} className="bg-surface-overlay rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GestureIcon gesture={binding.gesture} size={20} />
              <input
                value={binding.name}
                onChange={(e) => updateBinding(binding.id, { name: e.target.value })}
                className="bg-transparent text-sm font-medium text-gray-200 outline-none border-b border-transparent focus:border-zegy-500 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateBinding(binding.id, { enabled: !binding.enabled })}
                className={`h-5 w-9 rounded-full transition-colors ${binding.enabled ? "bg-zegy-600" : "bg-gray-700"}`}
              >
                <span className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${binding.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <button onClick={() => removeBinding(binding.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label>Hold (ms)</Label>
              <Input
                type="number"
                value={binding.holdTime}
                onChange={(e) => updateBinding(binding.id, { holdTime: Math.max(200, parseInt(e.target.value) || 200) })}
              />
            </div>
            <div>
              <Label>Cooldown (ms)</Label>
              <Input
                type="number"
                value={binding.cooldown}
                onChange={(e) => updateBinding(binding.id, { cooldown: Math.max(500, parseInt(e.target.value) || 500) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Actions</span>
              <button onClick={() => addAction(binding.id)} className="text-xs text-zegy-400 hover:text-zegy-300">
                + Add action
              </button>
            </div>
            {binding.actions.map((action, ai) => (
              <div key={action.id} className="flex gap-2 items-start">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <Input
                    placeholder="light.living_room"
                    value={action.entityId}
                    onChange={(e) => updateAction(binding.id, ai, "entityId", e.target.value)}
                  />
                  <Input
                    placeholder="turn_on"
                    value={action.service}
                    onChange={(e) => updateAction(binding.id, ai, "service", e.target.value)}
                  />
                </div>
                <button onClick={() => removeAction(binding.id, ai)} className="mt-2 text-gray-600 hover:text-red-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Btn variant="ghost" size="sm" onClick={() => addBinding("palm")}>
          <span className="flex items-center gap-1.5">
            <GestureIcon gesture="palm" size={14} /> Add Palm Gesture
          </span>
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => addBinding("fist")}>
          <span className="flex items-center gap-1.5">
            <GestureIcon gesture="fist" size={14} /> Add Fist Gesture
          </span>
        </Btn>
      </div>
    </div>
  );
}

function CalibrationModal({
  open,
  camera,
  onClose,
  onComplete,
}: {
  open: boolean;
  camera: CameraConfig | null;
  onClose: () => void;
  onComplete: (palmFeatures: number[][], fistFeatures: number[][]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [step, setStep] = useState<"idle" | "palm" | "fist" | "done">("idle");
  const [samples, setSamples] = useState<{ palm: number[][]; fist: number[][] }>({ palm: [], fist: [] });
  const [countdown, setCountdown] = useState(0);
  const { ready, captureFeatures } = useHandDetection(null, open);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const streamUrl = camera ? api.getCameraStreamUrl(camera.id) : "";

  useEffect(() => {
    if (!open || !camera || !videoRef.current) return;
    const video = videoRef.current;
    video.src = streamUrl;
    video.crossOrigin = "anonymous";
    video.play().catch(() => {});

    return () => {
      video.pause();
      video.src = "";
      if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, camera, streamUrl]);

  useEffect(() => {
    if (!open || !canvasRef.current || !videoRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open]);

  const startCapture = useCallback(
    (gesture: "palm" | "fist") => {
      if (!videoRef.current || !ready) return;
      setStep(gesture);
      setCountdown(3);

      let count = 3;
      const timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(timer);
          let captured = 0;
          sampleIntervalRef.current = setInterval(() => {
            if (!videoRef.current) return;
            const features = captureFeatures(videoRef.current, performance.now());
            if (features) {
              setSamples((prev) => ({
                ...prev,
                [gesture]: [...prev[gesture], features],
              }));
              captured++;
            }
            if (captured >= 10) {
              if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
              if (gesture === "palm") {
                setStep("idle");
              } else {
                setStep("done");
              }
            }
          }, 200);
        }
      }, 1000);
    },
    [ready, captureFeatures],
  );

  const handleFinish = () => {
    onComplete(samples.palm, samples.fist);
    setSamples({ palm: [], fist: [] });
    setStep("idle");
  };

  if (!open || !camera) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-raised rounded-2xl p-6 shadow-2xl">
        <h3 className="section-title mb-4">Calibrate — {camera.name}</h3>

        <div className="relative aspect-video bg-black rounded-xl overflow-hidden mb-4">
          <video ref={videoRef} className="hidden" muted playsInline />
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-6xl font-bold text-white drop-shadow-lg">{countdown}</span>
            </div>
          )}
          {step !== "idle" && step !== "done" && countdown === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-xl text-sm">
              {step === "palm" ? "Show your open palm ✋" : "Make a fist ✊"} — capturing...
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${samples.palm.length >= 10 ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            ✋ Palm: {samples.palm.length}/10
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${samples.fist.length >= 10 ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            ✊ Fist: {samples.fist.length}/10
          </div>
        </div>

        {!ready && <p className="text-xs text-yellow-500 mb-3">Loading hand detection model...</p>}

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {samples.palm.length < 10 && (
            <Btn variant="secondary" onClick={() => startCapture("palm")} disabled={!ready || step !== "idle"}>
              Capture Palm
            </Btn>
          )}
          {samples.palm.length >= 10 && samples.fist.length < 10 && (
            <Btn variant="secondary" onClick={() => startCapture("fist")} disabled={!ready || step !== "idle"}>
              Capture Fist
            </Btn>
          )}
          {step === "done" && (
            <Btn onClick={handleFinish}>Save Calibration</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function LivePreview({
  camera,
  onGestureDetected,
}: {
  camera: CameraConfig;
  onGestureDetected: (gesture: CameraGestureType) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastGestureRef = useRef<{ gesture: CameraGestureType; since: number } | null>(null);
  const cooldownUntilRef = useRef(0);
  const [currentDetection, setCurrentDetection] = useState<{ gesture: CameraGestureType | null; confidence: number }>({ gesture: null, confidence: 0 });
  const { ready, loadError, detectFromVideo } = useHandDetection(camera.calibration, camera.enabled);

  const streamUrl = api.getCameraStreamUrl(camera.id);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    video.src = streamUrl;
    video.crossOrigin = "anonymous";
    video.play().catch(() => {});
    return () => {
      video.pause();
      video.src = "";
    };
  }, [streamUrl]);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !overlayRef.current || !ready) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const ctx = canvas.getContext("2d");
    const octx = overlay.getContext("2d");
    if (!ctx || !octx) return;

    const activeBindings = camera.gestures.filter((g) => g.enabled);
    const holdTimes = Object.fromEntries(activeBindings.map((g) => [g.gesture, g.holdTime]));
    const cooldowns = Object.fromEntries(activeBindings.map((g) => [g.gesture, g.cooldown]));

    const loop = () => {
      if (video.paused || video.ended) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      overlay.width = w;
      overlay.height = h;

      ctx.drawImage(video, 0, 0);

      const result = detectFromVideo(video, performance.now());
      octx.clearRect(0, 0, w, h);

      if (result.landmarks) {
        octx.strokeStyle = "#14b8a6";
        octx.lineWidth = 2;
        for (const lm of result.landmarks) {
          octx.beginPath();
          octx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
          octx.fill();
        }
        octx.fillStyle = "#14b8a6";
        for (const lm of result.landmarks) {
          octx.beginPath();
          octx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
          octx.fill();
        }
      }

      const now = performance.now();
      setCurrentDetection({ gesture: result.gesture, confidence: result.confidence });

      if (result.gesture && now > cooldownUntilRef.current) {
        if (lastGestureRef.current && lastGestureRef.current.gesture === result.gesture) {
          const held = now - lastGestureRef.current.since;
          const requiredHold = holdTimes[result.gesture] ?? 800;
          if (held >= requiredHold) {
            onGestureDetected(result.gesture);
            cooldownUntilRef.current = now + (cooldowns[result.gesture] ?? 3000);
            lastGestureRef.current = null;
          }
        } else {
          lastGestureRef.current = { gesture: result.gesture, since: now };
        }
      } else if (!result.gesture) {
        lastGestureRef.current = null;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, camera.gestures, detectFromVideo, onGestureDetected]);

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-red-400 text-sm px-4 text-center">{loadError}</p>
        </div>
      )}
      {!ready && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <p className="text-gray-400 text-sm">Loading detection model...</p>
        </div>
      )}
      {currentDetection.gesture && (
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm">
          <GestureIcon gesture={currentDetection.gesture} size={16} />
          <span className="capitalize">{currentDetection.gesture}</span>
          <span className="text-gray-400">{Math.round(currentDetection.confidence * 100)}%</span>
        </div>
      )}
    </div>
  );
}

function CameraDetail({
  camera,
  groups,
  onUpdate,
  onDelete,
  onCalibrate,
}: {
  camera: CameraConfig;
  groups: CameraGroup[];
  onUpdate: (id: string, data: Partial<CameraConfig>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onCalibrate: (camera: CameraConfig) => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleGestureDetected = useCallback(
    async (gesture: CameraGestureType) => {
      try {
        await api.triggerCameraGesture(camera.id, gesture);
      } catch {
        // ignore
      }
    },
    [camera.id],
  );

  const handleGesturesChange = async (gestures: CameraGestureBinding[]) => {
    setSaving(true);
    try {
      await onUpdate(camera.id, { gestures });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{camera.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{camera.url}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${camera.calibration ? "bg-green-600/20 text-green-400" : "bg-yellow-600/20 text-yellow-400"}`}>
            {camera.calibration ? "Calibrated" : "Not calibrated"}
          </span>
          <button
            onClick={() => onUpdate(camera.id, { enabled: !camera.enabled })}
            className={`h-6 w-11 rounded-full transition-colors ${camera.enabled ? "bg-zegy-600" : "bg-gray-700"}`}
          >
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${camera.enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {camera.enabled && (
        <LivePreview camera={camera} onGestureDetected={handleGestureDetected} />
      )}

      {!camera.enabled && (
        <div className="aspect-video bg-surface-overlay rounded-xl flex items-center justify-center">
          <p className="text-gray-600 text-sm">Camera disabled</p>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <span className="section-title text-sm">Gesture Bindings</span>
          {saving && <span className="text-xs text-gray-500">Saving...</span>}
        </div>
        <GestureBindingEditor gestures={camera.gestures} onChange={handleGesturesChange} />
      </Card>

      <div className="flex gap-2">
        <Btn variant="secondary" size="sm" onClick={() => onCalibrate(camera)}>
          {camera.calibration ? "Recalibrate" : "Calibrate"}
        </Btn>
        <Btn variant="danger" size="sm" onClick={() => onDelete(camera.id)}>
          Delete Camera
        </Btn>
      </div>
    </div>
  );
}

export default function CameraGestures() {
  const {
    cameras,
    groups,
    loading,
    refresh,
    createCamera,
    updateCamera,
    removeCamera,
    calibrate,
    createGroup,
    updateGroup,
    removeGroup,
  } = useCameras();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [calibratingCamera, setCalibratingCamera] = useState<CameraConfig | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const selectedCamera = cameras.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && cameras.length > 0) {
      setSelectedId(cameras[0].id);
    }
  }, [cameras, selectedId]);

  const handleAddCamera = async (data: { name: string; url: string; snapshotUrl: string; username: string; password: string; groupId: string | null }) => {
    const cam = await createCamera(data);
    setSelectedId(cam.id);
    setAddModalOpen(false);
  };

  const handleCalibrationComplete = async (palmFeatures: number[][], fistFeatures: number[][]) => {
    if (!calibratingCamera) return;
    await calibrate(calibratingCamera.id, palmFeatures, fistFeatures);
    setCalibratingCamera(null);
    refresh();
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim() });
    setNewGroupName("");
    setGroupModalOpen(false);
  };

  const editingGroup = groups.find((g) => g.id === editingGroupId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-8 w-8 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Camera Gestures</h1>
          <p className="page-subtitle">Control your home with hand gestures via IP cameras</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => setGroupModalOpen(true)}>New Group</Btn>
          <Btn onClick={() => setAddModalOpen(true)}>Add Camera</Btn>
        </div>
      </div>

      {cameras.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-gray-500 mb-2">
            <svg className="h-12 w-12 mx-auto mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-sm">No cameras configured</p>
            <p className="text-xs text-gray-600 mt-1">Add an IP camera to get started with hand gesture controls</p>
          </div>
          <Btn className="mt-4" onClick={() => setAddModalOpen(true)}>Add Your First Camera</Btn>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-3 space-y-4">
            <Card className="p-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">Cameras</span>
              <div className="mt-2 space-y-1">
                {cameras.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => setSelectedId(cam.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-all ${
                      selectedId === cam.id
                        ? "bg-zegy-600/15 text-zegy-400"
                        : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-300"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${cam.enabled ? "bg-green-500" : "bg-gray-600"}`} />
                    <span className="truncate flex-1">{cam.name}</span>
                    {cam.calibration && (
                      <svg className="h-3.5 w-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </Card>

            {groups.length > 0 && (
              <Card className="p-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">Groups</span>
                <div className="mt-2 space-y-1">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => setEditingGroupId(editingGroupId === group.id ? null : group.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-all ${
                        editingGroupId === group.id
                          ? "bg-zegy-600/15 text-zegy-400"
                          : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-300"
                      }`}
                    >
                      <span className="truncate flex-1">{group.name}</span>
                      <span className="text-xs text-gray-600">
                        {cameras.filter((c) => c.groupId === group.id).length}
                      </span>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="col-span-12 md:col-span-9">
            {editingGroupId && editingGroup ? (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-100">{editingGroup.name}</h2>
                  <div className="flex gap-2">
                    <Btn variant="ghost" size="sm" onClick={() => setEditingGroupId(null)}>Close</Btn>
                    <Btn variant="danger" size="sm" onClick={() => { removeGroup(editingGroup.id); setEditingGroupId(null); }}>Delete Group</Btn>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Gestures defined here apply to all cameras in this group ({cameras.filter((c) => c.groupId === editingGroup.id).length} cameras).
                </p>
                <GestureBindingEditor
                  gestures={editingGroup.gestures}
                  onChange={(gestures) => updateGroup(editingGroup.id, { gestures })}
                />
              </Card>
            ) : selectedCamera ? (
              <CameraDetail
                camera={selectedCamera}
                groups={groups}
                onUpdate={updateCamera}
                onDelete={async (id) => {
                  await removeCamera(id);
                  setSelectedId(cameras.find((c) => c.id !== id)?.id ?? null);
                }}
                onCalibrate={setCalibratingCamera}
              />
            ) : (
              <Card className="text-center py-12">
                <p className="text-gray-500 text-sm">Select a camera from the sidebar</p>
              </Card>
            )}
          </div>
        </div>
      )}

      <AddCameraModal
        open={addModalOpen}
        groups={groups}
        onClose={() => setAddModalOpen(false)}
        onSave={handleAddCamera}
      />

      <CalibrationModal
        open={!!calibratingCamera}
        camera={calibratingCamera}
        onClose={() => setCalibratingCamera(null)}
        onComplete={handleCalibrationComplete}
      />

      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGroupModalOpen(false)} />
          <div className="relative w-full max-w-sm bg-surface-raised rounded-2xl p-6 shadow-2xl">
            <h3 className="section-title mb-4">New Camera Group</h3>
            <Label>Group Name</Label>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Downstairs Cameras"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddGroup(); }}
            />
            <div className="mt-5 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setGroupModalOpen(false)}>Cancel</Btn>
              <Btn onClick={handleAddGroup} disabled={!newGroupName.trim()}>Create Group</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { subscribe } from "../api/ws";
import { api } from "../api/client";

const GESTURE_ICONS: Record<string, string> = {
  swipe_left: "←",
  swipe_right: "→",
  swipe_up: "↑",
  swipe_down: "↓",
  approach: "⬆",
  retreat: "⬇",
  wave: "👋",
  push: "⏩",
  pull: "⏪",
};

const GESTURE_LABELS: Record<string, string> = {
  swipe_left: "Swipe Left",
  swipe_right: "Swipe Right",
  swipe_up: "Swipe Up",
  swipe_down: "Swipe Down",
  approach: "Approach",
  retreat: "Retreat",
  wave: "Wave",
  push: "Push",
  pull: "Pull",
};

interface ToastItem {
  uid: number;
  eventId: string;
  bindingId: string;
  bindingName: string;
  gesture: string;
  confidence: number;
  actionNames: string[];
  feedback: "confirmed" | "rejected" | null;
  createdAt: number;
}

const AUTO_DISMISS_MS = 9000;

let uidCounter = 0;

export default function GestureToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((uid: number) => {
    setToasts((prev) => prev.filter((t) => t.uid !== uid));
  }, []);

  useEffect(() => {
    return subscribe((data) => {
      if (data.type !== "gesture_event") return;
      const uid = ++uidCounter;
      setToasts((prev) => {
        const next = [
          {
            uid,
            eventId: (data.id as string) ?? "",
            bindingId: data.bindingId as string,
            bindingName: (data.bindingName as string) || (data.bindingId as string),
            gesture: data.gesture as string,
            confidence: (data.confidence as number) ?? 0,
            actionNames: (data.actionNames as string[]) ?? [],
            feedback: null,
            createdAt: Date.now(),
          },
          ...prev,
        ];
        return next.slice(0, 3);
      });
      setTimeout(() => dismiss(uid), AUTO_DISMISS_MS);
    });
  }, [dismiss]);

  const handleFeedback = useCallback(async (toast: ToastItem, correct: boolean) => {
    setToasts((prev) =>
      prev.map((t) => (t.uid === toast.uid ? { ...t, feedback: correct ? "confirmed" : "rejected" } : t)),
    );
    try {
      await api.submitGestureFeedback(toast.bindingId, correct);
    } catch {
      // silent – feedback is best-effort
    }
    setTimeout(() => dismiss(toast.uid), 1800);
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none" style={{ width: 320 }}>
      {toasts.map((toast) => (
        <Toast key={toast.uid} toast={toast} onFeedback={handleFeedback} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onFeedback,
  onDismiss,
}: {
  toast: ToastItem;
  onFeedback: (t: ToastItem, correct: boolean) => void;
  onDismiss: (uid: number) => void;
}) {
  const [progress, setProgress] = useState(100);
  const startRef = useRef(toast.createdAt);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast.feedback !== null) return;
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [toast.feedback]);

  const icon = GESTURE_ICONS[toast.gesture] ?? "?";
  const label = GESTURE_LABELS[toast.gesture] ?? toast.gesture;
  const conf = Math.round(toast.confidence * 100);

  const feedbackColor =
    toast.feedback === "confirmed"
      ? "border-teal-500/60 bg-teal-500/10"
      : toast.feedback === "rejected"
      ? "border-red-500/40 bg-red-500/10"
      : "border-white/10 bg-[#1c202d]";

  return (
    <div
      className={`pointer-events-auto rounded-2xl border shadow-2xl shadow-black/40 overflow-hidden transition-all duration-200 ${feedbackColor}`}
      style={{ backdropFilter: "blur(12px)" }}
    >
      {/* Progress bar */}
      {toast.feedback === null && (
        <div className="h-0.5 bg-white/[0.06]">
          <div
            className="h-full bg-teal-500 transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-teal-500/15 text-xl flex-shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm font-semibold text-zinc-100 truncate">{toast.bindingName}</span>
              <span className="text-[10px] text-teal-400 font-medium bg-teal-500/15 px-1.5 py-0.5 rounded-full">
                {conf}%
              </span>
            </div>
            <span className="text-xs text-zinc-400">{label} detected</span>
          </div>
          <button
            onClick={() => onDismiss(toast.uid)}
            className="text-zinc-600 hover:text-zinc-400 mt-0.5 flex-shrink-0"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Actions triggered */}
        {toast.actionNames.length > 0 && (
          <div className="mb-3 space-y-0.5">
            {toast.actionNames.map((name, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-teal-500 flex-shrink-0">
                  <path fillRule="evenodd" d="M8 1.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 1.5zm0 9a.75.75 0 01.75.75v1.25a.75.75 0 01-1.5 0v-1.25A.75.75 0 018 10.5zM2.5 8a5.5 5.5 0 1011 0 5.5 5.5 0 00-11 0z" clipRule="evenodd" />
                </svg>
                <span className="truncate">{name}</span>
              </div>
            ))}
          </div>
        )}
        {toast.actionNames.length === 0 && (
          <p className="mb-3 text-[11px] text-zinc-600 italic">No actions configured for this binding</p>
        )}

        {/* Feedback buttons */}
        {toast.feedback === null ? (
          <div className="flex gap-2">
            <button
              onClick={() => onFeedback(toast, true)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-teal-600/20 hover:bg-teal-600/35 border border-teal-500/25 text-teal-400 text-xs font-medium py-2 transition"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Correct
            </button>
            <button
              onClick={() => onFeedback(toast, false)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-600/15 hover:bg-red-600/30 border border-red-500/20 text-red-400 text-xs font-medium py-2 transition"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
              False positive
            </button>
          </div>
        ) : (
          <div className={`flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium ${
            toast.feedback === "confirmed"
              ? "bg-teal-500/15 text-teal-400"
              : "bg-red-500/15 text-red-400"
          }`}>
            {toast.feedback === "confirmed" ? (
              <><svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>Feedback saved</>
            ) : (
              <><svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>Marked as false positive</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

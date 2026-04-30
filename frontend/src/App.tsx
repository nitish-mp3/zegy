import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./contexts/AppContext";
import { useCameras } from "./hooks/useCameras";
import GestureDetector from "./components/GestureDetector";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import FloorPlan from "./pages/FloorPlan";
import Automations from "./pages/Automations";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import Gestures from "./pages/Gestures";
import CameraGestures from "./pages/CameraGestures";
import Lighting from "./pages/Lighting";
import type { CameraConfig, CameraGestureBinding, CameraGroup } from "./api/client";

const IS_GESTURE_RUNNER =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("zegyGestureRunner") === "1";

function effectiveBindings(camera: CameraConfig, groups: CameraGroup[]): CameraGestureBinding[] {
  const group = camera.groupId ? groups.find((g) => g.id === camera.groupId) : null;
  return [...camera.gestures, ...(group?.gestures ?? [])].filter((binding) => binding.enabled);
}

function GestureManager() {
  const { cameras, groups, refresh } = useCameras();

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <>
      {cameras.map((camera) => {
        const bindings = effectiveBindings(camera, groups);
        if (!camera.enabled || bindings.length === 0) return null;
        return <GestureDetector key={camera.id} camera={camera} bindings={bindings} />;
      })}
    </>
  );
}

export default function App() {
  if (IS_GESTURE_RUNNER) {
    return (
      <AppProvider>
        <GestureManager />
      </AppProvider>
    );
  }

  return (
    <AppProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/floorplan" element={<FloorPlan />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/gestures" element={<Gestures />} />
          <Route path="/camera-gestures" element={<CameraGestures />} />
          <Route path="/lighting" element={<Lighting />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppProvider>
  );
}

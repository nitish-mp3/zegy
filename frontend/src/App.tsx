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

function GestureManager() {
  const { cameras } = useCameras();
  return (
    <>
      {cameras.filter(c => c.enabled && c.gestures.some(g => g.enabled)).map(cam => (
        <GestureDetector
          key={cam.id}
          camera={cam}
        />
      ))}
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <GestureManager />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/floorplan" element={<FloorPlan />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/gestures" element={<Gestures />} />
          <Route path="/camera-gestures" element={<CameraGestures />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppProvider>
  );
}

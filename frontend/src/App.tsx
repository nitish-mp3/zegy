import { Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./contexts/AppContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import FloorPlan from "./pages/FloorPlan";
import Automations from "./pages/Automations";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import Gestures from "./pages/Gestures";

export default function App() {
  return (
    <AppProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/floorplan" element={<FloorPlan />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/gestures" element={<Gestures />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppProvider>
  );
}

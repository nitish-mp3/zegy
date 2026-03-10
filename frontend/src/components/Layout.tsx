import { useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { useWebSocket } from "../hooks/useWebSocket";

export default function Layout({ children }: { children: ReactNode }) {
  useWebSocket();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuToggle={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

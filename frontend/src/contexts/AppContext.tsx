import { createContext, useContext, useReducer, type ReactNode } from "react";

export interface SensorReading {
  entityId: string;
  value: string | number;
  unit: string;
  timestamp: string;
  deviceClass: string | null;
}

export interface DeviceSummary {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  area: string | null;
  firmware: string | null;
  sensors: SensorReading[];
  online: boolean;
}

export interface FloorPlanNode {
  id: string;
  entityId: string;
  label: string;
  x: number;
  y: number;
}

export interface FloorPlanLayout {
  width: number;
  height: number;
  backgroundUrl: string | null;
  nodes: FloorPlanNode[];
}

interface AppState {
  devices: DeviceSummary[];
  sensors: SensorReading[];
  floorplan: FloorPlanLayout;
  loading: boolean;
  error: string | null;
  connected: boolean;
}

type Action =
  | { type: "SET_DEVICES"; payload: DeviceSummary[] }
  | { type: "SET_SENSORS"; payload: SensorReading[] }
  | { type: "SET_FLOORPLAN"; payload: FloorPlanLayout }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_CONNECTED"; payload: boolean }
  | { type: "UPDATE_SENSOR"; payload: { entityId: string; value: string | number; timestamp: string } };

const initialState: AppState = {
  devices: [],
  sensors: [],
  floorplan: { width: 800, height: 600, backgroundUrl: null, nodes: [] },
  loading: false,
  error: null,
  connected: false,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_DEVICES":
      return { ...state, devices: action.payload };
    case "SET_SENSORS":
      return { ...state, sensors: action.payload };
    case "SET_FLOORPLAN":
      return { ...state, floorplan: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_CONNECTED":
      return { ...state, connected: action.payload };
    case "UPDATE_SENSOR": {
      const { entityId, value, timestamp } = action.payload;
      return {
        ...state,
        sensors: state.sensors.map((s) =>
          s.entityId === entityId ? { ...s, value, timestamp } : s,
        ),
        devices: state.devices.map((d) => ({
          ...d,
          sensors: d.sensors.map((s) =>
            s.entityId === entityId ? { ...s, value, timestamp } : s,
          ),
        })),
      };
    }
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

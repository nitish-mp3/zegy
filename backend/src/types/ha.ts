export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HaDevice {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  area_id: string | null;
  sw_version: string | null;
  hw_version: string | null;
  config_entries: string[];
  connections: [string, string][];
  identifiers: [string, string][];
}

export interface HaArea {
  area_id: string;
  name: string;
  floor_id: string | null;
}

export interface HaEntity {
  entity_id: string;
  device_id: string | null;
  platform: string;
  area_id: string | null;
  name: string | null;
  disabled_by: string | null;
}

# Zegy Sensor Manager — Add-on Documentation

## Overview

Zegy Sensor Manager is a Home Assistant add-on that provides a unified dashboard for monitoring all your sensor devices. It surfaces real-time readings, device health, spatial floor plan mapping, and analytics — all through an ingress panel inside Home Assistant.

## Installation

1. Add the repository to your Home Assistant add-on store: `https://github.com/wirsy/zegy`
2. Install **Zegy Sensor Manager** from the store.
3. Start the add-on.
4. Open the **Zegy** panel from the sidebar.

## Features

### Dashboard
- At-a-glance statistics: device count, sensor count, availability, areas.
- Live sensor readings with automatic real-time updates via WebSocket.
- Device cards showing all associated sensors.

### Devices
- Full device listing pulled from the Home Assistant device registry.
- Search and filter by name, manufacturer, or area.
- Detailed device panel with all sensor readings.

### Floor Plan
- Drag-and-drop sensor placement on a canvas.
- Live values displayed on placed sensor nodes.
- Persistent layout saved to your HA config directory.

### Analytics
- Sensor distribution by device class and area.
- Device health table with availability status indicators.

### Settings
- Backend health check and uptime display.

## Configuration

No manual configuration is needed. The add-on automatically connects to Home Assistant via the Supervisor API. All data is read from your existing sensor entities and device registry.

## Data Storage

Floor plan layouts are stored in `/config/zegy/floorplan.json` on your Home Assistant instance.

## Support

- GitHub: https://github.com/wirsy/zegy
- Issues: https://github.com/wirsy/zegy/issues

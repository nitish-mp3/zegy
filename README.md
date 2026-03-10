# Zegy Sensor Manager

A real-time sensor monitoring, spatial mapping, and analytics platform for Home Assistant.

## Key Features

| Feature | Description |
|---------|-------------|
| Live Dashboard | Real-time sensor readings with auto-updating values |
| Device Explorer | Browse all sensor devices with search, filtering, and detail panels |
| Floor Plan Editor | Drag-and-drop sensor placement on an interactive canvas |
| Analytics | Sensor distribution by class and area, device health overview |
| WebSocket Streaming | Instant state change propagation without polling |

## Architecture

- **Backend**: Fastify + TypeScript — high-performance API server with WebSocket support
- **Frontend**: React + TypeScript + Vite + TailwindCSS — modern SPA with responsive design
- **HA Integration**: Supervisor API + WebSocket subscription for real-time state changes

## Documentation

- **[Add-on Documentation](DOCS.md)** — For Home Assistant OS installations
- **[Standalone Docker Documentation](DOCS-DOCKER.md)** — For non-add-on HA installations

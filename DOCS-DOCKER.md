# Zegy Sensor Manager — Standalone Docker Documentation

## Overview

If your Home Assistant installation does not support add-ons (e.g., Home Assistant Container, Home Assistant Core), you can run Zegy Sensor Manager as a standalone Docker container.

## Prerequisites

- Docker and Docker Compose installed on your system.
- A Home Assistant instance accessible on your network.
- A **long-lived access token** from Home Assistant.

## Generating a Long-Lived Access Token

1. Open your Home Assistant UI.
2. Navigate to your **Profile** (bottom-left).
3. Scroll to **Long-Lived Access Tokens**.
4. Click **Create Token**, name it `zegy`, and copy the token.

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/nky001/zegy.git
   cd zegy
   ```

2. Copy the environment file:
   ```bash
   cp .env-example .env
   ```

3. Edit `.env` with your values:
   ```
   HA_URL=http://your-ha-ip:8123
   HA_TOKEN=your_long_lived_access_token_here
   PORT=47200
   ```

4. Start the container:
   ```bash
   docker compose up -d
   ```

5. Open `http://your-docker-host:47200` in your browser.

## Updating

```bash
cd zegy
git pull
docker compose up -d --build
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to HA | Verify `HA_URL` is reachable from the Docker host |
| 401 / 403 errors | Regenerate your long-lived access token in HA |
| No devices shown | Ensure your HA instance has sensor devices configured |
| Port conflict | Change `PORT` in `.env` to an available port |

## Support

- GitHub: https://github.com/wirsy/zegy
- Issues: https://github.com/wirsy/zegy/issues

ARG BUILD_FROM=ghcr.io/hassio-addons/base:19.0.0

# --------------- build stage ---------------
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --include=dev

COPY backend backend
COPY frontend frontend
RUN npm run build --workspaces
RUN npm prune --omit=dev --workspaces

# --------------- add-on stage ---------------
FROM ${BUILD_FROM} AS addon
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV NODE_ENV=production \
    PORT=47200 \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app

RUN apk add --no-cache nodejs npm

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY rootfs/ /

RUN chmod +x /etc/s6-overlay/s6-rc.d/zegy/run

EXPOSE 47200/tcp

# --------------- standalone stage ---------------
FROM node:20-alpine AS standalone
WORKDIR /app

ENV NODE_ENV=production \
    PORT=47200 \
    FRONTEND_DIST=/app/frontend/dist

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist

EXPOSE 47200/tcp
CMD ["node", "backend/dist/index.js"]

# --------------- default target ---------------
FROM addon AS final

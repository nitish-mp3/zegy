import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import os from "node:os";
import ffmpegBin from "ffmpeg-static";
import { loadJson, saveJson } from "../store";
import { callService } from "../ha/client";
import { logger } from "../logger";
import type {
  CameraConfig,
  CameraGroup,
  CameraGestureBinding,
  CameraCalibration,
  CameraGestureType,
  DiscoveredCamera,
  ActionStep,
} from "../types";

const CAMERAS_FILE = "cameras.json";
const CAMERA_GROUPS_FILE = "camera-groups.json";

export function loadCameras(): CameraConfig[] {
  const raw = loadJson<CameraConfig[]>(CAMERAS_FILE, []);
  return raw.map((c) => ({
    ...c,
    gestures: Array.isArray(c.gestures) ? c.gestures : [],
    calibration: c.calibration ?? null,
    groupId: c.groupId ?? null,
    snapshotUrl: c.snapshotUrl ?? "",
    username: c.username ?? "",
    password: c.password ?? "",
  }));
}

function saveCameras(cameras: CameraConfig[]): void {
  saveJson(CAMERAS_FILE, cameras);
}

function loadGroups(): CameraGroup[] {
  return loadJson<CameraGroup[]>(CAMERA_GROUPS_FILE, []);
}

function saveGroups(groups: CameraGroup[]): void {
  saveJson(CAMERA_GROUPS_FILE, groups);
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateActions(arr: unknown): ActionStep[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (a: Record<string, unknown>) =>
        typeof a.entityId === "string" && typeof a.service === "string",
    )
    .map((a: Record<string, unknown>) => ({
      id: typeof a.id === "string" ? a.id : genId("as"),
      entityId: a.entityId as string,
      service: a.service as string,
      data: typeof a.data === "object" && a.data !== null ? (a.data as Record<string, unknown>) : undefined,
      delay: typeof a.delay === "number" ? Math.max(0, a.delay) : 0,
    }));
}

const VALID_GESTURE_TYPES: CameraGestureType[] = ["palm", "fist", "point", "thumbs_up"];

function validateGestureBinding(raw: unknown): CameraGestureBinding | null {
  const b = raw as Record<string, unknown>;
  const gesture = b.gesture as string;
  if (!VALID_GESTURE_TYPES.includes(gesture as CameraGestureType)) return null;
  return {
    id: typeof b.id === "string" ? b.id : genId("cgb"),
    gesture: gesture as CameraGestureType,
    name: typeof b.name === "string" ? b.name : gesture,
    holdTime: typeof b.holdTime === "number" ? Math.max(200, b.holdTime) : 800,
    cooldown: typeof b.cooldown === "number" ? Math.max(500, b.cooldown) : 3000,
    actions: validateActions(b.actions),
    enabled: typeof b.enabled === "boolean" ? b.enabled : true,
  };
}

function buildAuthHeaders(cam: CameraConfig): Record<string, string> {
  if (!cam.username) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${cam.username}:${cam.password}`).toString("base64")}`,
  };
}

async function executeGestureActions(actions: ActionStep[]): Promise<void> {
  for (const action of actions) {
    if (action.delay > 0) {
      await new Promise<void>((r) => setTimeout(r, action.delay));
    }
    try {
      const domain = action.entityId.split(".")[0];
      await callService(domain, action.service, {
        entity_id: action.entityId,
        ...action.data,
      });
      logger.info({ entityId: action.entityId, service: action.service }, "Camera gesture action executed");
    } catch (err) {
      logger.error({ err, entityId: action.entityId }, "Failed to execute camera gesture action");
    }
  }
}

export async function cameraRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cameras", async (_req, reply) => {
    const cameras = loadCameras();
    const safe = cameras.map((c) => ({
      ...c,
      password: "",
      passwordSet: !!c.password,
    }));
    return reply.send(safe);
  });

  app.post("/api/cameras", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name || !url) {
      return reply.status(400).send({ error: "Name and URL are required" });
    }

    const camera: CameraConfig = {
      id: genId("cam"),
      name,
      url,
      snapshotUrl: typeof body.snapshotUrl === "string" ? body.snapshotUrl.trim() : "",
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      groupId: typeof body.groupId === "string" ? body.groupId : null,
      gestures: [],
      calibration: null,
    };

    const cameras = loadCameras();
    cameras.push(camera);
    saveCameras(cameras);
    return reply.status(201).send({ ...camera, password: "", passwordSet: !!camera.password });
  });

  app.put<{ Params: { id: string } }>("/api/cameras/:id", async (req, reply) => {
    const cameras = loadCameras();
    const idx = cameras.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: "Camera not found" });

    const body = req.body as Record<string, unknown>;
    const cam = cameras[idx];

    if (typeof body.name === "string") cam.name = body.name.trim();
    if (typeof body.url === "string") cam.url = body.url.trim();
    if (typeof body.snapshotUrl === "string") cam.snapshotUrl = body.snapshotUrl.trim();
    if (typeof body.username === "string") cam.username = body.username;
    if (typeof body.password === "string" && body.password !== "") cam.password = body.password;
    if (typeof body.enabled === "boolean") cam.enabled = body.enabled;
    if (typeof body.groupId === "string" || body.groupId === null) cam.groupId = body.groupId as string | null;

    if (Array.isArray(body.gestures)) {
      cam.gestures = (body.gestures as unknown[])
        .map(validateGestureBinding)
        .filter((g): g is CameraGestureBinding => g !== null);
    }

    cameras[idx] = cam;
    saveCameras(cameras);
    return reply.send({ ...cam, password: "", passwordSet: !!cam.password });
  });

  app.delete<{ Params: { id: string } }>("/api/cameras/:id", async (req, reply) => {
    const cameras = loadCameras();
    const filtered = cameras.filter((c) => c.id !== req.params.id);
    if (filtered.length === cameras.length) {
      return reply.status(404).send({ error: "Camera not found" });
    }
    saveCameras(filtered);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/api/cameras/:id/calibrate", async (req, reply) => {
    const cameras = loadCameras();
    const idx = cameras.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: "Camera not found" });

    const body = req.body as Record<string, unknown>;
    const palmFeatures = body.palmFeatures as number[][];
    const fistFeatures = body.fistFeatures as number[][];

    if (!Array.isArray(palmFeatures) || !Array.isArray(fistFeatures)) {
      return reply.status(400).send({ error: "palmFeatures and fistFeatures arrays required" });
    }

    const calibration: CameraCalibration = {
      palmFeatures,
      fistFeatures,
      calibratedAt: new Date().toISOString(),
    };

    cameras[idx].calibration = calibration;
    saveCameras(cameras);
    return reply.send({ ok: true, calibration });
  });

  app.post<{ Params: { id: string } }>("/api/cameras/:id/trigger", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const gesture = body.gesture as string;
    if (!VALID_GESTURE_TYPES.includes(gesture as CameraGestureType)) {
      return reply.status(400).send({ error: "Invalid gesture type" });
    }

    const cameras = loadCameras();
    const camera = cameras.find((c) => c.id === req.params.id);
    if (!camera) return reply.status(404).send({ error: "Camera not found" });

    const matchingBindings: CameraGestureBinding[] = [];

    for (const g of camera.gestures) {
      if (g.enabled && g.gesture === gesture) matchingBindings.push(g);
    }

    if (camera.groupId) {
      const groups = loadGroups();
      const group = groups.find((g) => g.id === camera.groupId);
      if (group) {
        for (const g of group.gestures) {
          if (g.enabled && g.gesture === gesture) matchingBindings.push(g);
        }
      }
    }

    if (matchingBindings.length === 0) {
      return reply.send({ triggered: false, reason: "No matching bindings" });
    }

    const allActions = matchingBindings.flatMap((b) => b.actions);
    if (allActions.length > 0) {
      executeGestureActions(allActions).catch(() => {});
    }

    logger.info({ cameraId: camera.id, gesture, bindings: matchingBindings.length }, "Camera gesture triggered");
    return reply.send({ triggered: true, gesture, bindingsMatched: matchingBindings.length });
  });

  app.get<{ Params: { id: string } }>("/api/cameras/:id/snapshot", async (req, reply) => {
    const cameras = loadCameras();
    const camera = cameras.find((c) => c.id === req.params.id);
    if (!camera) return reply.status(404).send({ error: "Camera not found" });

    const targetUrl = camera.snapshotUrl || camera.url;
    if (!targetUrl) return reply.status(400).send({ error: "No URL configured" });

    try {
      const response = await fetch(targetUrl, {
        headers: buildAuthHeaders(camera),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok || !response.body) {
        return reply.status(502).send({ error: "Camera unavailable" });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return reply
        .type(response.headers.get("content-type") || "image/jpeg")
        .send(buffer);
    } catch (err) {
      logger.debug({ err, cameraId: camera.id }, "Camera snapshot failed");
      return reply.status(502).send({ error: "Camera unavailable" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/cameras/:id/stream", async (req, reply) => {
    const cameras = loadCameras();
    const camera = cameras.find((c) => c.id === req.params.id);
    if (!camera) return reply.status(404).send({ error: "Camera not found" });

    if (!camera.url) return reply.status(400).send({ error: "No URL configured" });

    if (/^rtsp:\/\//i.test(camera.url)) {
      // Transcode RTSP → MJPEG via FFmpeg so any browser can display it.
      let rtspUrl = camera.url;
      if (camera.username) {
        const withoutScheme = camera.url.slice("rtsp://".length);
        rtspUrl = `rtsp://${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@${withoutScheme}`;
      }

      if (!ffmpegBin) {
        return reply.status(502).send({ error: "FFmpeg binary not found in package" });
      }

      const proc = spawn(
        ffmpegBin,
        [
          "-loglevel", "quiet",
          "-rtsp_transport", "tcp",
          "-i", rtspUrl,
          "-f", "mpjpeg",
          "-q:v", "5",
          "-r", "10",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );

      const { stdout } = proc;
      if (!stdout) {
        return reply.status(502).send({ error: "Failed to start stream process" });
      }

      proc.on("error", (err: NodeJS.ErrnoException) => {
        logger.error({ err, cameraId: camera.id }, "FFmpeg process error");
        if (!reply.raw.headersSent) {
          reply.status(502).send({ error: "RTSP stream failed" });
        }
      });

      reply.raw.writeHead(200, {
        "Content-Type": "multipart/x-mixed-replace; boundary=ffserver",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      });

      stdout.pipe(reply.raw);
      req.raw.on("close", () => proc.kill("SIGTERM"));
      return;
    }

    const controller = new AbortController();
    const onReqClose = () => controller.abort();
    req.raw.on("close", onReqClose);

    try {
      const upstream = await fetch(camera.url, {
        headers: buildAuthHeaders(camera),
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        req.raw.off("close", onReqClose);
        return reply.status(502).send({ error: "Camera stream unavailable" });
      }

      const contentType = upstream.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame";

      reply.raw.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      });

      const readable = Readable.fromWeb(upstream.body as never);
      readable.pipe(reply.raw);

      req.raw.on("close", () => readable.destroy());
    } catch (err) {
      req.raw.off("close", onReqClose);
      if ((err as { name?: string }).name !== "AbortError") {
        logger.debug({ err, cameraId: camera.id }, "Camera stream failed");
      }
      if (!reply.raw.headersSent) {
        return reply.status(502).send({ error: "Camera stream unavailable" });
      }
    }
  });

  app.get("/api/camera-groups", async (_req, reply) => {
    return reply.send(loadGroups());
  });

  app.post("/api/camera-groups", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return reply.status(400).send({ error: "Name is required" });

    const group: CameraGroup = {
      id: genId("cg"),
      name,
      gestures: Array.isArray(body.gestures)
        ? (body.gestures as unknown[]).map(validateGestureBinding).filter((g): g is CameraGestureBinding => g !== null)
        : [],
    };

    const groups = loadGroups();
    groups.push(group);
    saveGroups(groups);
    return reply.status(201).send(group);
  });

  app.put<{ Params: { id: string } }>("/api/camera-groups/:id", async (req, reply) => {
    const groups = loadGroups();
    const idx = groups.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: "Group not found" });

    const body = req.body as Record<string, unknown>;
    if (typeof body.name === "string") groups[idx].name = body.name.trim();
    if (Array.isArray(body.gestures)) {
      groups[idx].gestures = (body.gestures as unknown[])
        .map(validateGestureBinding)
        .filter((g): g is CameraGestureBinding => g !== null);
    }

    saveGroups(groups);
    return reply.send(groups[idx]);
  });

  app.delete<{ Params: { id: string } }>("/api/camera-groups/:id", async (req, reply) => {
    const groups = loadGroups();
    const filtered = groups.filter((g) => g.id !== req.params.id);
    if (filtered.length === groups.length) {
      return reply.status(404).send({ error: "Group not found" });
    }
    saveGroups(filtered);

    const cameras = loadCameras();
    let changed = false;
    for (const cam of cameras) {
      if (cam.groupId === req.params.id) {
        cam.groupId = null;
        changed = true;
      }
    }
    if (changed) saveCameras(cameras);

    return reply.send({ ok: true });
  });

  app.get("/api/cameras/discover", async (req, reply) => {
    const query = req.query as Record<string, string>;
    let subnets: string[];
    if (query.subnet) {
      if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(query.subnet)) {
        return reply.status(400).send({ error: "Invalid subnet format. Expected x.x.x (e.g. 192.168.1)" });
      }
      subnets = [query.subnet];
    } else {
      subnets = getLocalSubnets();
    }

    if (subnets.length === 0) {
      return reply.send({ found: [], subnets: [] });
    }

    const found: DiscoveredCamera[] = [];
    for (const subnet of subnets) {
      const results = await scanSubnet(subnet);
      found.push(...results);
    }

    return reply.send({ found, subnets });
  });
}

function getLocalSubnets(): string[] {
  const subnets: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const parts = iface.address.split(".");
      const first = parseInt(parts[0]);
      const second = parseInt(parts[1]);
      const isPrivate =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
      if (isPrivate) {
        subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  }
  return [...new Set(subnets)];
}

const CAMERA_BRANDS: [RegExp, string][] = [
  [/axis/i,       "Axis"],
  [/hikvision/i,  "Hikvision"],
  [/dahua/i,      "Dahua"],
  [/amcrest/i,    "Amcrest"],
  [/reolink/i,    "Reolink"],
  [/foscam/i,     "Foscam"],
  [/hanwha|samsung/i, "Hanwha"],
  [/vivotek/i,    "Vivotek"],
  [/uniview/i,    "Uniview"],
  [/ipcam/i,      "IP Camera"],
];

const CAMERA_PATHS: Record<number, { stream: string; snapshot: string }> = {
  80:   { stream: "/video",       snapshot: "/snapshot.jpg" },
  8080: { stream: "/video",       snapshot: "/snapshot.jpg" },
  8081: { stream: "/video",       snapshot: "/snapshot.jpg" },
  554:  { stream: "/",            snapshot: "/" },
};

const SNAPSHOT_CANDIDATES = [
  "/snapshot.jpg", "/snapshot", "/cgi-bin/snapshot.cgi",
  "/image.jpg", "/still.jpg", "/frame.jpg",
];

const STREAM_CANDIDATES = [
  "/video", "/mjpeg", "/stream", "/live",
  "/cgi-bin/mjpeg", "/videostream.cgi", "/mjpeg.cgi",
  "/axis-cgi/mjpeg.cgi", "/nphMotionJpeg",
];

async function probeCameraHost(ip: string, port: number): Promise<DiscoveredCamera | null> {
  const base = `http://${ip}:${port}`;
  let serverHeader = "";
  let requiresAuth = false;
  let isCamera = false;
  let streamUrl = "";
  let snapshotUrl = "";

  try {
    const res = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(1500),
      method: "GET",
    });

    serverHeader = res.headers.get("server") ?? "";
    requiresAuth = res.status === 401 || res.status === 403 || !!res.headers.get("www-authenticate");
    const ct = res.headers.get("content-type") ?? "";

    if (ct.includes("multipart") || ct.includes("video")) {
      isCamera = true;
      streamUrl = `${base}/`;
    } else if (requiresAuth) {
      isCamera = true;
    }

    for (const sc of STREAM_CANDIDATES) {
      if (isCamera) break;
      try {
        const sr = await fetch(`${base}${sc}`, {
          signal: AbortSignal.timeout(800),
          method: "HEAD",
        });
        const sct = sr.headers.get("content-type") ?? "";
        if (sct.includes("multipart") || sct.includes("video") || sr.status === 401) {
          isCamera = true;
          streamUrl = `${base}${sc}`;
        }
      } catch {
        // skip
      }
    }
  } catch {
    return null;
  }

  if (!serverHeader && !requiresAuth && !isCamera) return null;

  const bools = CAMERA_BRANDS.find(([pattern]) => pattern.test(serverHeader));
  const brand = bools ? bools[1] : (serverHeader ? serverHeader.split("/")[0].trim() : null);

  const isKnownBrand = !!bools;
  if (!isCamera && !isKnownBrand && !requiresAuth) return null;

  if (!streamUrl) {
    streamUrl = `${base}${CAMERA_PATHS[port]?.stream ?? "/video"}`;
  }

  for (const sc of SNAPSHOT_CANDIDATES) {
    try {
      const sr = await fetch(`${base}${sc}`, {
        signal: AbortSignal.timeout(800),
        method: "HEAD",
      });
      const sct = sr.headers.get("content-type") ?? "";
      if (sct.includes("image") || sr.status === 401) {
        snapshotUrl = `${base}${sc}`;
        break;
      }
    } catch {
      // skip
    }
  }

  if (!snapshotUrl) {
    snapshotUrl = `${base}${CAMERA_PATHS[port]?.snapshot ?? "/snapshot.jpg"}`;
  }

  const name = brand ? `${brand} @ ${ip}` : `Camera @ ${ip}`;
  const confidence: "confirmed" | "likely" =
    isCamera || isKnownBrand ? "confirmed" : "likely";

  logger.debug({ ip, port, brand }, "Discovered camera");

  return { ip, port, name, streamUrl, snapshotUrl, brand: brand ?? null, confidence, requiresAuth };
}

async function scanSubnet(subnet: string): Promise<DiscoveredCamera[]> {
  const BATCH = 60;
  const PORTS = [80, 8080];
  const found: DiscoveredCamera[] = [];

  const tasks: Array<() => Promise<void>> = [];
  for (let i = 1; i <= 254; i++) {
    for (const port of PORTS) {
      const ip = `${subnet}.${i}`;
      tasks.push(async () => {
        const result = await probeCameraHost(ip, port);
        if (result) found.push(result);
      });
    }
  }

  for (let i = 0; i < tasks.length; i += BATCH) {
    await Promise.allSettled(tasks.slice(i, i + BATCH).map((t) => t()));
  }

  return found;
}

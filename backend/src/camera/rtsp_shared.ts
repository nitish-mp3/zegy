import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import ffmpegBin from "ffmpeg-static";
import { logger } from "../logger";

const BOUNDARY = "zegyshared";

type Subscriber = PassThrough;

interface StreamState {
  cameraId: string;
  rtspUrl: string;
  proc: ReturnType<typeof spawn> | null;
  subscribers: Set<Subscriber>;
  lastFrame: Buffer | null;
  lastFrameAt: number;
  restartTimer: NodeJS.Timeout | null;
  stopping: boolean;
}

const streams = new Map<string, StreamState>();

function getOrCreateState(cameraId: string, rtspUrl: string): StreamState {
  const existing = streams.get(cameraId);
  if (existing) {
    existing.rtspUrl = rtspUrl;
    return existing;
  }
  const s: StreamState = {
    cameraId,
    rtspUrl,
    proc: null,
    subscribers: new Set(),
    lastFrame: null,
    lastFrameAt: 0,
    restartTimer: null,
    stopping: false,
  };
  streams.set(cameraId, s);
  return s;
}

function scheduleRestart(state: StreamState, delayMs: number): void {
  if (state.stopping) return;
  if (state.restartTimer) return;
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (state.stopping) return;
    startProc(state).catch(() => {});
  }, delayMs);
}

async function startProc(state: StreamState): Promise<void> {
  if (state.stopping) return;
  if (state.proc && !state.proc.killed) return;
  if (!ffmpegBin) throw new Error("FFmpeg binary not found");

  const proc = spawn(
    ffmpegBin,
    [
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-i",
      state.rtspUrl,
      "-vf",
      "fps=10",
      "-q:v",
      "5",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  state.proc = proc;

  proc.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ cameraId: state.cameraId, msg: chunk.toString().trim() }, "FFmpeg stderr (shared)");
  });

  proc.on("close", () => {
    state.proc = null;
    if (state.stopping) return;
    // If anyone still wants frames, keep trying.
    if (state.subscribers.size > 0) scheduleRestart(state, 1500);
  });

  // Parse jpeg frames from stdout and cache last one
  let buffer: Buffer = Buffer.alloc(0);
  proc.stdout.on("data", (chunk: Buffer) => {
    if (state.stopping) return;
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi === -1) {
        if (buffer.length > 2_000_000) buffer = Buffer.alloc(0);
        return;
      }
      if (soi > 0) buffer = buffer.subarray(soi);
      const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (eoi === -1) return;
      const frame = buffer.subarray(0, eoi + 2);
      buffer = buffer.subarray(eoi + 2);
      state.lastFrame = frame;
      state.lastFrameAt = Date.now();
    }
  });

  logger.info({ cameraId: state.cameraId }, "RTSP shared stream started");
}

function writeMultipartFrame(out: Subscriber, jpegFrame: Buffer): void {
  out.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegFrame.length}\r\n\r\n`);
  out.write(jpegFrame);
  out.write("\r\n");
}

export function getSharedRtspBoundary(): string {
  return BOUNDARY;
}

export function subscribeSharedRtsp(cameraId: string, rtspUrl: string): {
  stream: PassThrough;
  close: () => void;
  ensureStarted: () => void;
  getLastFrame: () => Buffer | null;
} {
  const state = getOrCreateState(cameraId, rtspUrl);
  const out = new PassThrough();
  state.subscribers.add(out);

  const ensureStarted = () => {
    startProc(state).catch((err) => {
      logger.debug({ err, cameraId }, "Failed to start shared RTSP ffmpeg");
      scheduleRestart(state, 2000);
    });
  };

  // Pump frames on a timer so each subscriber gets proper multipart boundaries.
  const timer = setInterval(() => {
    if (out.destroyed) return;
    const f = state.lastFrame;
    if (!f) return;
    try {
      writeMultipartFrame(out, f);
    } catch {
      // ignore
    }
  }, 120);

  // const close = () => {
  //   clearInterval(timer);
  //   state.subscribers.delete(out);
  //   out.end();
  //   if (state.subscribers.size === 0) {
  //     // Keep proc alive only while someone is subscribed; background worker uses its own subscription.
  //     // Give a short grace period so quick UI reopen doesn't restart.
  //     setTimeout(() => {
  //       if (state.subscribers.size > 0 || state.stopping) return;
  //       state.stopping = true;
  //       try {
  //         state.proc?.kill("SIGTERM");
  //       } catch {
  //         // ignore
  //       }
  //       state.proc = null;
  //       streams.delete(cameraId);
  //       logger.info({ cameraId }, "RTSP shared stream stopped (no subscribers)");
  //     }, 5000);
  //   }
  // };

  // out.on("close", close);
  // out.on("error", close);

  return {
    stream: out,
    close,
    ensureStarted,
    getLastFrame: () => state.lastFrame,
  };
}


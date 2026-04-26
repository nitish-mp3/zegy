import { logger } from "../logger";
import { config } from "../config";

type BrowserHandle = {
  stop: () => Promise<void>;
};

let handle: BrowserHandle | null = null;

function chromiumExecutableCandidates(): string[] {
  return [
    process.env.CHROMIUM_PATH ?? "",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
}

export function startHeadlessUiGestureRunner(): void {
  if (handle) return;

  // Fire and forget: the add-on should still run even if chromium can't start.
  (async () => {
    logger.info("Starting headless UI gesture runner (background)");
    const { chromium } = await import("playwright-core");

    const execPath =
      chromiumExecutableCandidates().find((p) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require("node:fs") as typeof import("node:fs");
          return fs.existsSync(p);
        } catch {
          return false;
        }
      }) ?? undefined;

    const browser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
    });

    const page = await context.newPage();
    page.on("console", (msg) => {
      // Keep this as debug to avoid log spam.
      logger.debug({ type: msg.type(), text: msg.text() }, "Headless UI console");
    });
    page.on("pageerror", (err) => {
      logger.warn({ err }, "Headless UI page error");
    });

    // Load a runner-only frontend mode so camera gesture detection continues
    // without a user keeping the add-on UI open.
    const url = `http://127.0.0.1:${config.port}/?zegyGestureRunner=1`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    logger.info({ url }, "Headless UI loaded");

    // Keep a lightweight heartbeat so we can detect if the page stalls.
    const heartbeat = setInterval(async () => {
      try {
        await page.evaluate(() => "ok");
      } catch (err) {
        logger.warn({ err }, "Headless UI heartbeat failed; restarting");
        try {
          await context.close();
        } catch {
          // ignore
        }
        try {
          await browser.close();
        } catch {
          // ignore
        }
        handle = null;
        startHeadlessUiGestureRunner();
      }
    }, 15_000);

    handle = {
      stop: async () => {
        clearInterval(heartbeat);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  })().catch((err) => {
    logger.error({ err }, "Failed to start headless UI gesture runner");
    handle = null;
  });
}

export async function stopHeadlessUiGestureRunner(): Promise<void> {
  const h = handle;
  handle = null;
  if (!h) return;
  await h.stop();
}

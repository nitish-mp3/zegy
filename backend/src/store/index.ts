import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";

const DATA_DIR = process.env.ZEGY_DATA_DIR ?? "/config/zegy";

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadJson<T>(filename: string, fallback: T): T {
  try {
    ensureDir();
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) return fallback;
    return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
  } catch (err) {
    logger.warn({ err, filename }, "Failed to load data, using fallback");
    return fallback;
  }
}

export function saveJson<T>(filename: string, data: T): void {
  ensureDir();
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

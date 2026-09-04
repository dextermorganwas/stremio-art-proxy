import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const memoryStore = new Map<string, Entry<unknown>>();

function diskPathFor(key: string): string {
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(config.cacheDir, `${hash}.json`);
}

function ensureCacheDir(): void {
  if (config.cacheBackend === 'disk' && !fs.existsSync(config.cacheDir)) {
    fs.mkdirSync(config.cacheDir, { recursive: true });
  }
}
ensureCacheDir();

export function cacheGet<T>(key: string): T | undefined {
  const hit = memoryStore.get(key) as Entry<T> | undefined;
  if (hit) {
    if (hit.expiresAt > Date.now()) return hit.value;
    memoryStore.delete(key);
  }

  if (config.cacheBackend === 'disk') {
    try {
      const filePath = diskPathFor(key);
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Entry<T>;
        if (raw.expiresAt > Date.now()) {
          memoryStore.set(key, raw);
          return raw.value;
        }
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      logger.warn('[cache] disk read failed for', key, err);
    }
  }

  return undefined;
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  const entry: Entry<T> = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
  memoryStore.set(key, entry);

  if (config.cacheBackend === 'disk') {
    try {
      ensureCacheDir();
      fs.writeFileSync(diskPathFor(key), JSON.stringify(entry));
    } catch (err) {
      logger.warn('[cache] disk write failed for', key, err);
    }
  }
}

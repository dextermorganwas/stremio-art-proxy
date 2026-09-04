import { config } from '../config';

let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < config.maxConcurrentUpstream) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

/** Caps how many upstream (TMDB/Metahub) requests run in parallel - the "resource intensity" knob. */
export async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await withUpstreamSlot(() => fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

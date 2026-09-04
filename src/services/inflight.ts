// If two requests for the exact same item/art-type arrive while the first
// one is still being resolved, the second (and third, etc.) just await the
// same in-flight promise instead of triggering duplicate upstream calls.
const inFlight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fn().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

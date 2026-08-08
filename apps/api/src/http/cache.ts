const inFlight = new Map<string, Promise<unknown>>();

/** Collapse identical live requests without storing the returned value. */
export async function coalescedJson<T>(
  namespace: string,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const compoundKey = `${namespace}:${key}`;
  const existing = inFlight.get(compoundKey);
  if (existing) return existing as Promise<T>;

  const pending = load();
  inFlight.set(compoundKey, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(compoundKey);
  }
}

async function cacheKey(namespace: string, key: string): Promise<Request> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://shop-overlap-cache.invalid/${namespace}/${hash}`);
}

/** Cache successful JSON values in Cloudflare's local Cache API and collapse identical live requests. */
export async function cachedJson<T>(
  namespace: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  return coalescedJson(namespace, key, async () => {
    const request = await cacheKey(namespace, key);
    const cache = typeof caches === "undefined"
      ? undefined
      : (caches as CacheStorage & { default: Cache }).default;
    const hit = await cache?.match(request);
    if (hit) return (await hit.json()) as T;

    const value = await load();
    const response = Response.json(value, {
      headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
    });
    await cache?.put(request, response);
    return value;
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "./index";

const env: Env = {
  GOOGLE_MAPS_API_KEY: "server-key",
  GOOGLE_MAPS_BROWSER_API_KEY: "browser-key",
  GOOGLE_MAPS_MAP_ID: "map-id",
  ALLOWED_ORIGIN: "https://example.github.io,http://localhost:3000",
};

function api(path: string, init: RequestInit = {}): Request {
  return new Request(`https://api.example.test${path}`, init);
}

async function body<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function place(id: string, text: string, containingPlaces: unknown[] = []) {
  return {
    id,
    displayName: { text },
    formattedAddress: `東京都千代田区 ${text}`,
    location: { latitude: 35, longitude: id.startsWith("alpha") ? 139 : 139.001 },
    googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${id}`,
    containingPlaces,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Worker API", () => {
  it("exposes the Google browser configuration", async () => {
    const response = await worker.fetch(api("/api/config"), env);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      googleMapsBrowserApiKey: "browser-key",
      googleMapsMapId: "map-id",
    });
  });

  it("reports an incomplete browser configuration", async () => {
    const response = await worker.fetch(api("/api/config"), {
      GOOGLE_MAPS_API_KEY: "server-key",
    });
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      error: { code: "GOOGLE_MAPS_BROWSER_NOT_CONFIGURED", retryable: false },
    });
  });

  it("serves the chain catalog with configured CORS", async () => {
    const response = await worker.fetch(api("/api/chains?q=スタバ", {
      headers: { Origin: "https://example.github.io" },
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.github.io");
    expect(await body(response)).toContainEqual(expect.objectContaining({ wikidata: "Q37158" }));
  });

  it("rejects an unconfigured origin", async () => {
    const response = await worker.fetch(api("/api/chains", {
      headers: { Origin: "https://attacker.example" },
    }), env);
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED", retryable: false },
    });
  });

  it("requires the server-side Google key for geocoding", async () => {
    const response = await worker.fetch(api("/api/geocode?q=東京駅"), {
      ...env,
      GOOGLE_MAPS_API_KEY: undefined,
    });
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      error: { code: "GOOGLE_PLACES_NOT_CONFIGURED", retryable: false },
    });
  });

  it("returns a shared containing Place and strips internal store fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/places:searchText")) {
        const request = JSON.parse(String(init?.body)) as { textQuery: string };
        const id = request.textQuery === "Alpha" ? "alpha-store" : "beta-store";
        return Response.json({ places: [place(id, `${request.textQuery} 東京店`, [{ id: "shared-mall" }])] });
      }
      if (url.includes("/places/shared-mall")) {
        return Response.json(place("shared-mall", "共有モール"));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        center: [139, 35],
        radiusMeters: 20_000,
        mode: "facility",
        chains: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
      }),
    }), env);

    expect(response.status).toBe(200);
    const payload = await body<{ provider?: unknown; results: Array<{ stores: Array<Record<string, unknown>> }> }>(response);
    expect(payload).not.toHaveProperty("provider");
    expect(payload.results).toEqual([expect.objectContaining({ name: "共有モール" })]);
    for (const store of payload.results[0].stores) {
      expect(store).not.toHaveProperty("sourceId");
      expect(store).not.toHaveProperty("containingPlaceIds");
      expect(store).toHaveProperty("address");
      expect(store).toHaveProperty("mapUri");
    }
  });

  it.each([
    { center: [139, 35], radiusMeters: 999 },
    { center: [139, 35], radiusMeters: 40_001 },
    { center: [120, 35], radiusMeters: 20_000 },
  ])("rejects invalid search bounds %#", async ({ center, radiusMeters }) => {
    const response = await worker.fetch(api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        center,
        radiusMeters,
        mode: "facility",
        chains: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
      }),
    }), env);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});

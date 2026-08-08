import { afterEach, describe, expect, it, vi } from "vitest";

import { googleWalkingMatrix, googleWalkingRoute } from "./google-routes";

const env = { GOOGLE_MAPS_API_KEY: "google-test-key" };
const locations: [number, number][] = [
  [139.7671, 35.6812],
  [139.7705, 35.6846],
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function matrixElement(originIndex: number, destinationIndex: number, options: {
  distanceMeters?: number;
  duration?: string;
  condition?: "ROUTE_EXISTS" | "ROUTE_NOT_FOUND";
  status?: Record<string, unknown>;
} = {}) {
  return {
    originIndex,
    destinationIndex,
    status: options.status ?? {},
    condition: options.condition ?? "ROUTE_EXISTS",
    ...(options.condition === "ROUTE_NOT_FOUND" ? {} : {
      distanceMeters: options.distanceMeters ?? originIndex * 100 + destinationIndex,
      duration: options.duration ?? `${originIndex * 10 + destinationIndex}s`,
    }),
  };
}

describe("Google Maps Routes provider", () => {
  it("normalizes a WALK matrix, including unavailable routes, with the minimal field mask", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(Response.json([
      matrixElement(1, 1, { distanceMeters: 0, duration: "0s" }),
      matrixElement(0, 1, { condition: "ROUTE_NOT_FOUND" }),
      matrixElement(1, 0, { distanceMeters: 451, duration: "71.5s" }),
      matrixElement(0, 0, { distanceMeters: 0, duration: "0s" }),
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(googleWalkingMatrix(locations, env)).resolves.toEqual({
      durations: [[0, null], [71.5, 0]],
      distances: [[0, null], [451, 0]],
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
    const request = fetchMock.mock.calls[0][1];
    expect(request?.headers).toMatchObject({
      "X-Goog-Api-Key": "google-test-key",
      "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      origins: [
        { waypoint: { location: { latLng: { latitude: 35.6812, longitude: 139.7671 } } } },
        { waypoint: { location: { latLng: { latitude: 35.6846, longitude: 139.7705 } } } },
      ],
      destinations: [
        { waypoint: { location: { latLng: { latitude: 35.6812, longitude: 139.7671 } } } },
        { waypoint: { location: { latLng: { latitude: 35.6846, longitude: 139.7705 } } } },
      ],
      travelMode: "WALK",
      languageCode: "ja",
      regionCode: "JP",
    });
  });

  it("splits 50 locations into 625-element-or-smaller matrix requests", async () => {
    const fiftyLocations: [number, number][] = Array.from(
      { length: 50 },
      (_, index) => [139 + index / 10_000, 35 + index / 10_000],
    );
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        origins: unknown[];
        destinations: unknown[];
      };
      return Response.json(Array.from({ length: payload.origins.length }, (_, originIndex) =>
        Array.from({ length: payload.destinations.length }, (_, destinationIndex) =>
          matrixElement(originIndex, destinationIndex),
        ),
      ).flat());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleWalkingMatrix(fiftyLocations, env);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      const payload = JSON.parse(String(init?.body)) as { origins: unknown[]; destinations: unknown[] };
      expect(payload.origins.length * payload.destinations.length).toBeLessThanOrEqual(625);
      expect(payload.origins.length).toBeLessThanOrEqual(25);
      expect(payload.destinations.length).toBeLessThanOrEqual(25);
    }
    expect(result.durations).toHaveLength(50);
    expect(result.durations.every((row) => row.length === 50)).toBe(true);
    expect(result.distances[49][49]).toBe(2_424);
  });

  it("converts a Google encoded walking polyline to the app's GeoJSON response", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(Response.json({
      routes: [{
        distanceMeters: 1803,
        duration: "451.6s",
        polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const route = await googleWalkingRoute([
      [120.2, 38.5],
      [120.95, 40.7],
      [126.453, 43.252],
    ], env);

    expect(route).toMatchObject({ distanceMeters: 1803, durationSeconds: 452 });
    expect(route.route.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]],
    });
    const request = fetchMock.mock.calls[0][1];
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(request?.headers).toMatchObject({
      "X-Goog-Api-Key": "google-test-key",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      travelMode: "WALK",
      intermediates: [{ location: { latLng: { latitude: 40.7, longitude: 120.95 } } }],
    });
  });

  it.each([
    { response: new Response("rate limited", { status: 429 }), status: 503, code: "GOOGLE_MAPS_RATE_LIMITED" },
    { response: new Response("forbidden", { status: 403 }), status: 503, code: "GOOGLE_MAPS_AUTH_ERROR" },
  ])("maps Google HTTP $code responses to a structured problem", async ({ response, status, code }) => {
    vi.stubGlobal("fetch", vi.fn(async () => response));

    await expect(googleWalkingMatrix(locations, env)).rejects.toMatchObject({ status, code });
  });

  it("maps Google timeouts and malformed route payloads to structured problems", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }));
    await expect(googleWalkingMatrix(locations, env)).rejects.toMatchObject({
      status: 504,
      code: "GOOGLE_MAPS_TIMEOUT",
    });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ routes: [{ distanceMeters: 10, duration: "1s" }] })));
    await expect(googleWalkingRoute(locations, env)).rejects.toMatchObject({
      status: 502,
      code: "GOOGLE_MAPS_INVALID_RESPONSE",
    });
  });

  it("rejects an incomplete matrix response instead of treating it as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([
      matrixElement(0, 0),
      matrixElement(0, 1),
      matrixElement(1, 0),
    ])));

    await expect(googleWalkingMatrix(locations, env)).rejects.toMatchObject({
      status: 502,
      code: "GOOGLE_MAPS_INVALID_RESPONSE",
    });
  });

  it("fails clearly before requesting Google when the API key is absent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(googleWalkingMatrix(locations, {})).rejects.toMatchObject({
      status: 503,
      code: "GOOGLE_MAPS_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

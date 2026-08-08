import type { Position, RouteResponse } from "@shop-overlap/api-contract";
import { coalescedJson } from "../../http/cache";
import { HttpProblem } from "../../http/problem";

/** Environment fields required by the Google Maps Platform Routes provider. */
export interface GoogleRoutesEnv {
  GOOGLE_MAPS_API_KEY?: string;
}

export interface GoogleMatrixResult {
  durations: Array<Array<number | null>>;
  distances: Array<Array<number | null>>;
}

const GOOGLE_ROUTES_BASE_URL = "https://routes.googleapis.com";
const GOOGLE_MATRIX_MAX_ELEMENTS = 625;
const GOOGLE_MATRIX_MAX_LOCATIONS = 50;
const GOOGLE_MATRIX_CHUNK_SIZE = Math.floor(Math.sqrt(GOOGLE_MATRIX_MAX_ELEMENTS));
const GOOGLE_ROUTE_MAX_INTERMEDIATES = 25;
const GOOGLE_TIMEOUT_MILLISECONDS = 20_000;

type JsonRecord = Record<string, unknown>;

type MatrixElement = {
  originIndex?: unknown;
  destinationIndex?: unknown;
  status?: unknown;
  condition?: unknown;
  distanceMeters?: unknown;
  duration?: unknown;
};

type GoogleRoutePayload = {
  routes?: Array<{
    distanceMeters?: unknown;
    duration?: unknown;
    polyline?: { encodedPolyline?: unknown };
  }>;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) &&
    typeof value[1] === "number" && Number.isFinite(value[1]);
}

function requireGoogleMapsKey(env: GoogleRoutesEnv): string {
  if (!env.GOOGLE_MAPS_API_KEY?.trim()) {
    throw new HttpProblem(503, "GOOGLE_MAPS_NOT_CONFIGURED", "Google Maps Platform のAPIキーが設定されていません。", false);
  }
  return env.GOOGLE_MAPS_API_KEY.trim();
}

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError" ||
    error instanceof Error && error.name === "TimeoutError";
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (response.status === 429) {
      throw new HttpProblem(503, "GOOGLE_MAPS_RATE_LIMITED", "Google Maps Platform の利用上限に達しました。しばらくしてから再度お試しください。", true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpProblem(503, "GOOGLE_MAPS_AUTH_ERROR", "Google Maps Platform の認証設定を確認してください。", false);
    }
    if (!response.ok) {
      throw new HttpProblem(
        502,
        "GOOGLE_MAPS_UNAVAILABLE",
        "Google Maps Platform から正常な応答を受信できませんでした。",
        response.status >= 500,
        { status: response.status },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    const timedOut = isTimeout(error);
    throw new HttpProblem(
      timedOut ? 504 : 502,
      timedOut ? "GOOGLE_MAPS_TIMEOUT" : "GOOGLE_MAPS_UNAVAILABLE",
      timedOut ? "Google Maps Platform の応答がタイムアウトしました。" : "Google Maps Platform に接続できませんでした。",
      true,
    );
  }
}

function waypoint([longitude, latitude]: Position): JsonRecord {
  return {
    location: {
      latLng: { latitude, longitude },
    },
  };
}

function locationCacheKey(locations: Position[]): string {
  return JSON.stringify(locations.map(([longitude, latitude]) => [
    Number(longitude.toFixed(6)),
    Number(latitude.toFixed(6)),
  ]));
}

function invalidGoogleResponse(message: string): HttpProblem {
  return new HttpProblem(502, "GOOGLE_MAPS_INVALID_RESPONSE", message, true);
}

function parseDuration(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(?:0|[1-9]\d*)(?:\.\d+)?s$/.exec(value);
  if (!match) return undefined;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function validDistance(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function parseDistance(value: unknown): number | undefined {
  // Routes API can omit a selected proto field when its value is the default 0.
  return value === undefined ? 0 : validDistance(value) ? value : undefined;
}

function validIndex(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < max;
}

function hasElementError(status: unknown): boolean {
  if (!isRecord(status)) {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }
  if (status.code === undefined) return false;
  if (typeof status.code !== "number" || !Number.isInteger(status.code) || status.code < 0) {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }
  return status.code !== 0;
}

function parseMatrixElement(
  element: unknown,
  originCount: number,
  destinationCount: number,
): { originIndex: number; destinationIndex: number; duration: number | null; distance: number | null } {
  if (!isRecord(element)) {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }
  const matrixElement = element as MatrixElement;
  if (!validIndex(matrixElement.originIndex, originCount) || !validIndex(matrixElement.destinationIndex, destinationCount)) {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }

  const elementHasError = hasElementError(matrixElement.status);
  if (matrixElement.condition === "ROUTE_NOT_FOUND" || elementHasError) {
    return {
      originIndex: matrixElement.originIndex,
      destinationIndex: matrixElement.destinationIndex,
      duration: null,
      distance: null,
    };
  }
  if (matrixElement.condition !== "ROUTE_EXISTS") {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }

  // A zero-valued field can be absent from a proto3 JSON response even when it
  // was requested in the field mask. This commonly occurs on matrix diagonals.
  const duration = matrixElement.duration === undefined ? 0 : parseDuration(matrixElement.duration);
  const distance = parseDistance(matrixElement.distanceMeters);
  if (duration === undefined || distance === undefined) {
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }
  return {
    originIndex: matrixElement.originIndex,
    destinationIndex: matrixElement.destinationIndex,
    duration,
    distance,
  };
}

function splitIntoChunks<T>(items: T[], chunkSize: number): Array<{ start: number; items: T[] }> {
  const chunks: Array<{ start: number; items: T[] }> = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push({ start, items: items.slice(start, start + chunkSize) });
  }
  return chunks;
}

function validateMatrixLocations(locations: Position[]): void {
  if (locations.length > GOOGLE_MATRIX_MAX_LOCATIONS) {
    throw new HttpProblem(400, "GOOGLE_MAPS_MATRIX_TOO_LARGE", "Google Maps Platform の徒歩時間計算は50地点までです。", false);
  }
  if (!locations.every(isPosition)) {
    throw new HttpProblem(400, "INVALID_REQUEST", "徒歩時間計算の地点が不正です。", false);
  }
}

async function requestMatrixBlock(
  origins: Position[],
  destinations: Position[],
  apiKey: string,
): Promise<unknown[]> {
  const response = await googleFetch(
    `${GOOGLE_ROUTES_BASE_URL}/distanceMatrix/v2:computeRouteMatrix`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
      },
      body: JSON.stringify({
        origins: origins.map((coordinate) => ({ waypoint: waypoint(coordinate) })),
        destinations: destinations.map((coordinate) => ({ waypoint: waypoint(coordinate) })),
        travelMode: "WALK",
        languageCode: "ja",
        regionCode: "JP",
      }),
      signal: timeoutSignal(GOOGLE_TIMEOUT_MILLISECONDS),
    },
  );
  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
    }
    return payload;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
  }
}

/**
 * Calculate a complete walking matrix. 50 candidates are split into 25×25
 * blocks so every individual Compute Route Matrix request remains within its
 * documented 625-element limit.
 */
export async function googleWalkingMatrix(locations: Position[], env: GoogleRoutesEnv): Promise<GoogleMatrixResult> {
  validateMatrixLocations(locations);
  if (locations.length === 0) return { durations: [], distances: [] };
  if (locations.length === 1) return { durations: [[0]], distances: [[0]] };

  const key = requireGoogleMapsKey(env);
  return coalescedJson("google-matrix", locationCacheKey(locations), async () => {
    const durations = Array.from({ length: locations.length }, () => Array<number | null>(locations.length).fill(null));
    const distances = Array.from({ length: locations.length }, () => Array<number | null>(locations.length).fill(null));
    const completed = Array.from({ length: locations.length }, () => Array<boolean>(locations.length).fill(false));
    const chunks = splitIntoChunks(locations, GOOGLE_MATRIX_CHUNK_SIZE);

    await Promise.all(chunks.flatMap((originChunk) => chunks.map(async (destinationChunk) => {
      const elements = await requestMatrixBlock(originChunk.items, destinationChunk.items, key);
      const expectedElementCount = originChunk.items.length * destinationChunk.items.length;
      if (elements.length !== expectedElementCount) {
        throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
      }
      for (const element of elements) {
        const parsed = parseMatrixElement(element, originChunk.items.length, destinationChunk.items.length);
        const originIndex = originChunk.start + parsed.originIndex;
        const destinationIndex = destinationChunk.start + parsed.destinationIndex;
        if (completed[originIndex][destinationIndex]) {
          throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
        }
        completed[originIndex][destinationIndex] = true;
        durations[originIndex][destinationIndex] = parsed.duration;
        distances[originIndex][destinationIndex] = parsed.distance;
      }
    })));

    if (!completed.every((row) => row.every(Boolean))) {
      throw invalidGoogleResponse("Google Maps Platform の徒歩時間計算から不正な応答を受信しました。");
    }
    return { durations, distances };
  });
}

function decodePolyline(encodedPolyline: string): Position[] {
  const coordinates: Position[] = [];
  let latitude = 0;
  let longitude = 0;
  let index = 0;

  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    while (index < encodedPolyline.length) {
      const value = encodedPolyline.charCodeAt(index++) - 63;
      if (value < 0 || value > 63 || shift > 30) {
        throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
      }
      result |= (value & 0x1f) << shift;
      shift += 5;
      if ((value & 0x20) === 0) return result & 1 ? ~(result >> 1) : result >> 1;
    }
    throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
  };

  while (index < encodedPolyline.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    const point: Position = [longitude / 1e5, latitude / 1e5];
    if (!isPosition(point) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
      throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
    }
    coordinates.push(point);
  }
  return coordinates;
}

function validateRouteLocations(locations: Position[]): void {
  if (locations.length < 2 || !locations.every(isPosition)) {
    throw new HttpProblem(400, "INVALID_REQUEST", "徒歩経路の地点が不正です。", false);
  }
  if (locations.length - 2 > GOOGLE_ROUTE_MAX_INTERMEDIATES) {
    throw new HttpProblem(400, "GOOGLE_MAPS_ROUTE_TOO_LARGE", "Google Maps Platform の徒歩経路は27地点までです。", false);
  }
}

/** Convert Google Compute Routes WALK output to the app's RouteResponse contract. */
export async function googleWalkingRoute(locations: Position[], env: GoogleRoutesEnv): Promise<RouteResponse> {
  validateRouteLocations(locations);
  const key = requireGoogleMapsKey(env);
  return coalescedJson("google-route", locationCacheKey(locations), async () => {
    const response = await googleFetch(
      `${GOOGLE_ROUTES_BASE_URL}/directions/v2:computeRoutes`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: waypoint(locations[0]),
          destination: waypoint(locations[locations.length - 1]),
          intermediates: locations.slice(1, -1).map(waypoint),
          travelMode: "WALK",
          languageCode: "ja",
          regionCode: "JP",
        }),
        signal: timeoutSignal(GOOGLE_TIMEOUT_MILLISECONDS),
      },
    );
    let payload: GoogleRoutePayload;
    try {
      payload = (await response.json()) as GoogleRoutePayload;
    } catch {
      throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
    }
    const route = payload.routes?.[0];
    const duration = route?.duration === undefined ? 0 : parseDuration(route.duration);
    const distance = parseDistance(route?.distanceMeters);
    const encodedPolyline = route?.polyline?.encodedPolyline;
    if (distance === undefined || duration === undefined || typeof encodedPolyline !== "string") {
      throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
    }
    const coordinates = decodePolyline(encodedPolyline);
    if (coordinates.length < 2) {
      throw invalidGoogleResponse("Google Maps Platform の徒歩経路から不正な応答を受信しました。");
    }
    const geoJson: RouteResponse["route"] = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: { summary: { distance, duration } },
      }],
    };
    return {
      route: geoJson,
      distanceMeters: Math.round(distance),
      durationSeconds: Math.round(duration),
    };
  });
}

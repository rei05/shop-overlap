import type {
  ChainInput,
  FacilityResult,
  GeocodeResult,
  Position,
  SourceAttribution,
  Store,
} from "@shop-overlap/api-contract";
import { circleBounds, haversineMeters } from "@shop-overlap/shared-ts";
import { coalescedJson } from "./cache";
import { HttpProblem } from "./problem";

const DEFAULT_GOOGLE_PLACES_URL = "https://places.googleapis.com/v1";
const TEXT_SEARCH_PATH = "places:searchText";
const MAX_TEXT_SEARCH_PAGES = 3;
const PAGE_SIZE = 20;

const GEOCODE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.attributions",
].join(",");

const STORE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.containingPlaces",
  "places.attributions",
  "nextPageToken",
].join(",");

const FACILITY_FIELD_MASK = [
  "id",
  "displayName",
  "location",
  "attributions",
].join(",");

export interface GooglePlacesEnvironment {
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_PLACES_API_URL?: string;
}

export interface GooglePlaceStore extends Store {
  sourceId: string;
  containingPlaceIds: string[];
  sourceAttributions: SourceAttribution[];
}

type GooglePlacePayload = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  googleMapsUri?: unknown;
  containingPlaces?: unknown;
  attributions?: unknown;
};

type GoogleTextSearchPayload = {
  places?: unknown;
  nextPageToken?: unknown;
};

type ParsedGooglePlace = {
  id: string;
  name: string;
  formattedAddress?: string;
  coordinate: Position;
  googleMapsUri?: string;
  containingPlaceIds: string[];
  sourceAttributions: SourceAttribution[];
};

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function requireGoogleKey(env: GooglePlacesEnvironment): string {
  const key = env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new HttpProblem(
      503,
      "GOOGLE_PLACES_NOT_CONFIGURED",
      "Google Places APIが設定されていません。",
      false,
    );
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

async function googleFetch(
  input: string,
  init: RequestInit,
  key: string,
  fieldMask: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Goog-Api-Key", key);
  headers.set("X-Goog-FieldMask", fieldMask);

  try {
    const response = await fetch(input, { ...init, headers });
    if (response.status === 429) {
      throw new HttpProblem(
        503,
        "GOOGLE_PLACES_RATE_LIMITED",
        "Google Places APIの利用上限に達しました。しばらくしてから再度お試しください。",
        true,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpProblem(
        503,
        "GOOGLE_PLACES_AUTH_ERROR",
        "Google Maps PlatformのAPIキーとPlaces APIの設定を確認してください。",
        false,
      );
    }
    if (!response.ok) {
      throw new HttpProblem(
        502,
        "GOOGLE_PLACES_UNAVAILABLE",
        "Google Places APIから正常な応答を受信できませんでした。",
        response.status >= 500,
        { status: response.status },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new HttpProblem(
      timedOut ? 504 : 502,
      timedOut ? "GOOGLE_PLACES_TIMEOUT" : "GOOGLE_PLACES_UNAVAILABLE",
      timedOut
        ? "Google Places APIの応答がタイムアウトしました。"
        : "Google Places APIに接続できませんでした。",
      true,
    );
  }
}

function invalidResponse(): HttpProblem {
  return new HttpProblem(
    502,
    "GOOGLE_PLACES_INVALID_RESPONSE",
    "Google Places APIから不正な応答を受信しました。",
    true,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

function normalizePlaceResourceId(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("places/")) return normalized.slice("places/".length) || undefined;
  return normalized;
}

/** Accept both current ContainingPlace fields and resource-name shaped fixtures. */
export function normalizeContainingPlaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.flatMap((entry): string[] => {
    if (typeof entry === "string") {
      const id = normalizePlaceResourceId(entry);
      return id ? [id] : [];
    }
    if (!isRecord(entry)) return [];
    for (const key of ["id", "placeId", "place", "name"] as const) {
      const candidate = entry[key];
      if (typeof candidate === "string") {
        const id = normalizePlaceResourceId(candidate);
        if (id) return [id];
      }
    }
    return [];
  });
  return [...new Set(ids)];
}

export function normalizeSourceAttributions(value: unknown): SourceAttribution[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidResponse();
  const attributions = value.flatMap((entry): SourceAttribution[] => {
    if (!isRecord(entry) || typeof entry.provider !== "string" || !entry.provider.trim()) return [];
    const provider = entry.provider.trim();
    if (entry.providerUri === undefined) return [{ provider }];
    if (typeof entry.providerUri !== "string") return [];
    try {
      const uri = new URL(entry.providerUri);
      if (uri.protocol !== "https:" && uri.protocol !== "http:") return [];
      return [{ provider, providerUri: uri.toString() }];
    } catch {
      return [];
    }
  });
  return [...new Map(attributions.map((item) => [`${item.provider}\n${item.providerUri ?? ""}`, item])).values()];
}

function parseGooglePlace(value: unknown): ParsedGooglePlace {
  if (!isRecord(value)) throw invalidResponse();
  const payload = value as GooglePlacePayload;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const latitude = payload.location?.latitude;
  const longitude = payload.location?.longitude;
  if (!id || !finiteNumber(latitude) || !finiteNumber(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw invalidResponse();
  }

  const displayName = typeof payload.displayName?.text === "string"
    ? payload.displayName.text.trim()
    : "";
  const formattedAddress = typeof payload.formattedAddress === "string"
    ? payload.formattedAddress.trim()
    : "";
  const googleMapsUri = typeof payload.googleMapsUri === "string"
    ? payload.googleMapsUri.trim()
    : "";
  return {
    id,
    name: displayName || formattedAddress || "名称不明",
    ...(formattedAddress ? { formattedAddress } : {}),
    coordinate: [longitude, latitude],
    ...(googleMapsUri ? { googleMapsUri } : {}),
    containingPlaceIds: normalizeContainingPlaceIds(payload.containingPlaces),
    sourceAttributions: normalizeSourceAttributions(payload.attributions),
  };
}

function parseTextSearchPayload(value: unknown): {
  places: ParsedGooglePlace[];
  nextPageToken?: string;
} {
  if (!isRecord(value)) throw invalidResponse();
  const payload = value as GoogleTextSearchPayload;
  if (payload.places !== undefined && !Array.isArray(payload.places)) throw invalidResponse();
  const places = (payload.places ?? []).map(parseGooglePlace);
  if (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== "string") {
    throw invalidResponse();
  }
  const nextPageToken = typeof payload.nextPageToken === "string"
    ? payload.nextPageToken.trim()
    : "";
  return { places, ...(nextPageToken ? { nextPageToken } : {}) };
}

function normalizeComparableName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s\u3000・･'’\-‐‑‒–—―ー()（）.．,，]/g, "");
}

export function googlePlaceMatchesChain(placeName: string, chain: ChainInput): boolean {
  const actual = normalizeComparableName(placeName);
  if (!actual) return false;
  return [chain.name, ...(chain.aliases ?? [])]
    .map(normalizeComparableName)
    .filter((candidate) => candidate.length >= 2)
    .some((candidate) => actual.includes(candidate) || candidate.includes(actual));
}

function googleMapsUrl(placeId: string, placeName: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", placeName);
  url.searchParams.set("query_place_id", placeId);
  return url.toString();
}

export function normalizeGoogleStore(
  place: ParsedGooglePlace,
  chain: ChainInput,
): GooglePlaceStore {
  return {
    id: `google:${place.id}:${chain.id}`,
    sourceId: place.id,
    chainId: chain.id,
    chainName: chain.name,
    name: place.name,
    coordinate: place.coordinate,
    ...(place.formattedAddress ? { address: place.formattedAddress } : {}),
    mapUri: place.googleMapsUri || googleMapsUrl(place.id, place.name),
    containingPlaceIds: place.containingPlaceIds,
    sourceAttributions: place.sourceAttributions,
  };
}

async function textSearchPage(
  requestBody: Record<string, unknown>,
  env: GooglePlacesEnvironment,
  fieldMask: string,
): Promise<{ places: ParsedGooglePlace[]; nextPageToken?: string }> {
  const key = requireGoogleKey(env);
  const response = await googleFetch(
    endpoint(env.GOOGLE_PLACES_API_URL || DEFAULT_GOOGLE_PLACES_URL, TEXT_SEARCH_PATH),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: timeoutSignal(12_000),
    },
    key,
    fieldMask,
  );
  return parseTextSearchPayload(await readJson(response));
}

async function textSearchPages(
  requestBody: Record<string, unknown>,
  env: GooglePlacesEnvironment,
  fieldMask: string,
  maxPages: number,
): Promise<ParsedGooglePlace[]> {
  const places: ParsedGooglePlace[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await textSearchPage(
      pageToken ? { ...requestBody, pageToken } : requestBody,
      env,
      fieldMask,
    );
    places.push(...payload.places);
    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }
  return places;
}

export async function geocodeGooglePlaces(
  text: string,
  env: GooglePlacesEnvironment,
): Promise<GeocodeResult[]> {
  const normalized = text.normalize("NFKC").trim();
  requireGoogleKey(env);
  if (!normalized) return [];

  return coalescedJson("google-geocode", normalized, async () => {
    const places = await textSearchPages({
      textQuery: normalized,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 5,
    }, env, GEOCODE_FIELD_MASK, 1);

    return places.slice(0, 5).map((place) => ({
      id: `google:${place.id}`,
      label: place.formattedAddress || place.name,
      coordinate: place.coordinate,
      ...(place.sourceAttributions.length > 0
        ? { sourceAttributions: place.sourceAttributions }
        : {}),
    }));
  });
}

async function searchOneChain(
  center: Position,
  radiusMeters: number,
  chain: ChainInput,
  env: GooglePlacesEnvironment,
): Promise<GooglePlaceStore[]> {
  const cacheKey = JSON.stringify({
    center: center.map((coordinate) => Number(coordinate.toFixed(6))),
    radiusMeters,
    chain: { id: chain.id, name: chain.name, aliases: chain.aliases ?? [] },
  });
  return coalescedJson("google-chain-stores", cacheKey, async () => {
    const [west, south, east, north] = circleBounds(center, radiusMeters);
    const places = await textSearchPages({
      textQuery: chain.name,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: PAGE_SIZE,
      locationRestriction: {
        rectangle: {
          low: { latitude: south, longitude: west },
          high: { latitude: north, longitude: east },
        },
      },
    }, env, STORE_FIELD_MASK, MAX_TEXT_SEARCH_PAGES);

    const seen = new Set<string>();
    return places.flatMap((place) => {
      if (seen.has(place.id) ||
          haversineMeters(place.coordinate, center) > radiusMeters ||
          !googlePlaceMatchesChain(place.name, chain)) {
        return [];
      }
      seen.add(place.id);
      return [normalizeGoogleStore(place, chain)];
    });
  });
}

export async function searchGoogleChainStores(
  center: Position,
  radiusMeters: number,
  chains: ChainInput[],
  env: GooglePlacesEnvironment,
): Promise<GooglePlaceStore[]> {
  requireGoogleKey(env);
  const storesByChain = await Promise.all(
    chains.map((chain) => searchOneChain(center, radiusMeters, chain, env)),
  );
  return storesByChain.flat();
}

/** Parent Place IDs that are explicitly shared by every requested chain. */
export function commonContainingPlaceIds(
  stores: GooglePlaceStore[],
  requiredChainIds: string[],
): string[] {
  const required = [...new Set(requiredChainIds)];
  if (required.length === 0) return [];

  const chainsByPlace = new Map<string, Set<string>>();
  const rankByPlace = new Map<string, number>();
  for (const store of stores) {
    if (!required.includes(store.chainId)) continue;
    store.containingPlaceIds.forEach((placeId, rank) => {
      const chainIds = chainsByPlace.get(placeId) ?? new Set<string>();
      chainIds.add(store.chainId);
      chainsByPlace.set(placeId, chainIds);
      rankByPlace.set(placeId, (rankByPlace.get(placeId) ?? 0) + rank);
    });
  }

  return [...chainsByPlace.entries()]
    .filter(([, chainIds]) => required.every((chainId) => chainIds.has(chainId)))
    .sort(([idA], [idB]) =>
      (rankByPlace.get(idA) ?? 0) - (rankByPlace.get(idB) ?? 0) || idA.localeCompare(idB))
    .map(([placeId]) => placeId);
}

async function googlePlaceDetails(
  placeId: string,
  env: GooglePlacesEnvironment,
): Promise<ParsedGooglePlace> {
  return coalescedJson("google-place-details", placeId, async () => {
    const key = requireGoogleKey(env);
    const url = new URL(endpoint(
      env.GOOGLE_PLACES_API_URL || DEFAULT_GOOGLE_PLACES_URL,
      `places/${encodeURIComponent(placeId)}`,
    ));
    url.searchParams.set("languageCode", "ja");
    url.searchParams.set("regionCode", "JP");
    const response = await googleFetch(
      url.toString(),
      { signal: timeoutSignal(10_000) },
      key,
      FACILITY_FIELD_MASK,
    );
    return parseGooglePlace(await readJson(response));
  });
}

export async function buildGoogleFacilityResults(
  stores: GooglePlaceStore[],
  requiredChainIds: string[],
  env: GooglePlacesEnvironment,
): Promise<FacilityResult[]> {
  const required = [...new Set(requiredChainIds)];
  const placeIds = commonContainingPlaceIds(stores, required).slice(0, 20);
  const details = await Promise.all(placeIds.map((placeId) => googlePlaceDetails(placeId, env)));

  return details.map((place) => {
    const containedStores = stores
      .filter((store) => required.includes(store.chainId) && store.containingPlaceIds.includes(place.id))
      .sort((a, b) =>
        required.indexOf(a.chainId) - required.indexOf(b.chainId) ||
        a.name.localeCompare(b.name, "ja"));
    return {
      kind: "facility",
      id: `google-facility:${place.id}`,
      name: place.name,
      subtitle: `${required.length}チェーン・${containedStores.length}店舗`,
      coordinate: place.coordinate,
      stores: containedStores,
      sourceAttributions: place.sourceAttributions,
    };
  });
}

import type {
  ChainInput,
  Position,
  RouteRequest,
  RuntimeConfig,
  SearchRequest,
  SearchResponse,
  Store,
} from "@shop-overlap/api-contract";
import {
  MAX_WALK_MINUTES,
  MAX_SEARCH_RADIUS_METERS,
  MIN_WALK_MINUTES,
  MIN_SEARCH_RADIUS_METERS,
  SEARCH_RADIUS_STEP_METERS,
  WALK_MINUTES_STEP,
  haversineMeters,
  pruneWalkingCandidates,
  solveWalkingRoutes,
} from "@shop-overlap/shared-ts";
import { findChains } from "@shop-overlap/chain-catalog";
import {
  buildGoogleFacilityResults,
  geocodeGooglePlaces,
  searchGoogleChainStores,
} from "./google-places";
import { googleWalkingMatrix, googleWalkingRoute } from "./google-routes";
import { asProblem, HttpProblem, problemResponse } from "./problem";

const API_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;
const JAPAN_BOUNDS = [122, 20, 154, 46] as const;

function publicStore(store: Store): Store {
  return {
    id: store.id,
    chainId: store.chainId,
    chainName: store.chainName,
    name: store.name,
    coordinate: store.coordinate,
    ...(store.address ? { address: store.address } : {}),
    ...(store.mapUri ? { mapUri: store.mapUri } : {}),
    ...(store.sourceAttributions?.length
      ? { sourceAttributions: store.sourceAttributions }
      : {}),
  };
}

function publicResults(results: SearchResponse["results"]): SearchResponse["results"] {
  return results.map((result) => ({
    ...result,
    stores: result.stores.map(publicStore),
  }));
}

export interface Env {
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_MAPS_BROWSER_API_KEY?: string;
  GOOGLE_MAPS_MAP_ID?: string;
  GOOGLE_PLACES_API_URL?: string;
  ALLOWED_ORIGIN?: string;
  ASSETS?: Fetcher;
}

function runtimeConfig(env: Env): RuntimeConfig {
  const browserKey = env.GOOGLE_MAPS_BROWSER_API_KEY?.trim();
  const mapId = env.GOOGLE_MAPS_MAP_ID?.trim();
  if (!browserKey || !mapId) {
    throw new HttpProblem(
      503,
      "GOOGLE_MAPS_BROWSER_NOT_CONFIGURED",
      "Google Mapsのブラウザ表示設定を確認してください。",
      false,
    );
  }
  return {
    googleMapsBrowserApiKey: browserKey,
    googleMapsMapId: mapId,
  };
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(API_HEADERS);
  const origin = request.headers.get("Origin")?.replace(/\/$/, "");
  const allowed = allowedOrigins(env);
  if (!origin) return headers;
  const sameOrigin = origin === new URL(request.url).origin;
  if (!sameOrigin && !allowed.includes("*") && !allowed.includes(origin)) {
    throw new HttpProblem(403, "ORIGIN_NOT_ALLOWED", "このWebサイトからのAPI利用は許可されていません。", false);
  }
  headers.set("Access-Control-Allow-Origin", allowed.includes("*") ? "*" : origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

function json(data: unknown, headers: Headers, status = 200): Response {
  return Response.json(data, { status, headers });
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpProblem(400, "INVALID_REQUEST", `${field} は有限の数値で指定してください。`);
  }
  return value;
}

function position(value: unknown, field = "center"): Position {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new HttpProblem(400, "INVALID_REQUEST", `${field} は [経度, 緯度] で指定してください。`);
  }
  const longitude = finiteNumber(value[0], `${field}[0]`);
  const latitude = finiteNumber(value[1], `${field}[1]`);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new HttpProblem(400, "INVALID_REQUEST", `${field} の緯度・経度が範囲外です。`);
  }
  return [longitude, latitude];
}

function validateSearchCenter(center: Position): void {
  const [longitude, latitude] = center;
  const [japanWest, japanSouth, japanEast, japanNorth] = JAPAN_BOUNDS;
  if (longitude < japanWest || longitude > japanEast || latitude < japanSouth || latitude > japanNorth) {
    throw new HttpProblem(400, "INVALID_REQUEST", "検索範囲の中心は日本国内を指定してください。");
  }
}

function nonEmptyString(value: unknown, field: string, maxLength = 120): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpProblem(400, "INVALID_REQUEST", `${field} を1〜${maxLength}文字で指定してください。`);
  }
  return value.trim();
}

function chainInput(value: unknown, index: number): ChainInput {
  if (!value || typeof value !== "object") {
    throw new HttpProblem(400, "INVALID_REQUEST", `chains[${index}] が不正です。`);
  }
  const candidate = value as Record<string, unknown>;
  const id = nonEmptyString(candidate.id, `chains[${index}].id`, 100);
  const name = nonEmptyString(candidate.name, `chains[${index}].name`, 100);
  let wikidata: string | undefined;
  if (candidate.wikidata !== undefined) {
    wikidata = nonEmptyString(candidate.wikidata, `chains[${index}].wikidata`, 20);
    if (!/^Q\d+$/.test(wikidata)) {
      throw new HttpProblem(400, "INVALID_REQUEST", `chains[${index}].wikidata が不正です。`);
    }
  }
  let aliases: string[] | undefined;
  if (candidate.aliases !== undefined) {
    if (!Array.isArray(candidate.aliases) || candidate.aliases.length > 10) {
      throw new HttpProblem(400, "INVALID_REQUEST", `chains[${index}].aliases は最大10件です。`);
    }
    aliases = candidate.aliases.map((alias, aliasIndex) =>
      nonEmptyString(alias, `chains[${index}].aliases[${aliasIndex}]`, 100),
    );
  }
  return { id, name, ...(wikidata ? { wikidata } : {}), ...(aliases ? { aliases } : {}) };
}

function parseSearchRequest(value: unknown): SearchRequest {
  if (!value || typeof value !== "object") {
    throw new HttpProblem(400, "INVALID_REQUEST", "検索条件をJSONオブジェクトで指定してください。");
  }
  const input = value as Record<string, unknown>;
  const center = position(input.center);
  validateSearchCenter(center);
  const radiusMeters = finiteNumber(input.radiusMeters, "radiusMeters");
  if (
    !Number.isInteger(radiusMeters) ||
    radiusMeters < MIN_SEARCH_RADIUS_METERS ||
    radiusMeters > MAX_SEARCH_RADIUS_METERS ||
    radiusMeters % SEARCH_RADIUS_STEP_METERS !== 0
  ) {
    throw new HttpProblem(400, "INVALID_REQUEST", "検索半径は1〜40kmの範囲で1km単位で指定してください。");
  }
  if (!Array.isArray(input.chains) || input.chains.length < 2 || input.chains.length > 5) {
    throw new HttpProblem(400, "INVALID_REQUEST", "チェーンは2〜5件指定してください。");
  }
  const chains = input.chains.map(chainInput);
  if (new Set(chains.map((chain) => chain.id)).size !== chains.length) {
    throw new HttpProblem(400, "INVALID_REQUEST", "同じチェーンを重複して指定できません。");
  }
  const wikidataIds = chains.flatMap((chain) => chain.wikidata ? [chain.wikidata] : []);
  const normalizedNames = chains.map((chain) =>
    chain.name.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s　]/g, ""),
  );
  if (
    new Set(wikidataIds).size !== wikidataIds.length ||
    new Set(normalizedNames).size !== normalizedNames.length
  ) {
    throw new HttpProblem(400, "INVALID_REQUEST", "同じチェーンを重複して指定できません。");
  }
  if (input.mode !== "facility" && input.mode !== "walking") {
    throw new HttpProblem(400, "INVALID_REQUEST", "mode は facility または walking を指定してください。");
  }
  let maxWalkMinutes: number | undefined;
  if (input.mode === "walking") {
    maxWalkMinutes = finiteNumber(input.maxWalkMinutes, "maxWalkMinutes");
    if (
      !Number.isInteger(maxWalkMinutes) ||
      maxWalkMinutes < MIN_WALK_MINUTES ||
      maxWalkMinutes > MAX_WALK_MINUTES ||
      (maxWalkMinutes - MIN_WALK_MINUTES) % WALK_MINUTES_STEP !== 0
    ) {
      throw new HttpProblem(400, "INVALID_REQUEST", "徒歩時間は5〜15分の範囲で5分単位で指定してください。");
    }
  }
  return { center, radiusMeters, chains, mode: input.mode, ...(maxWalkMinutes ? { maxWalkMinutes } : {}) };
}

async function requestJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > MAX_BODY_BYTES) throw new HttpProblem(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。", false);
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HttpProblem(400, "INVALID_JSON", "JSONを読み取れませんでした。");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpProblem(413, "REQUEST_TOO_LARGE", "リクエストが大きすぎます。", false);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpProblem(400, "INVALID_JSON", "正しいJSONを送信してください。");
  }
}

async function handleSearch(request: Request, env: Env): Promise<SearchResponse> {
  const input = parseSearchRequest(await requestJson(request));
  const stores = await searchGoogleChainStores(input.center, input.radiusMeters, input.chains, env);
  const foundChainIds = new Set(stores.map((store) => store.chainId));
  const missingChains = input.chains
    .filter((chain) => !foundChainIds.has(chain.id))
    .map((chain) => chain.name);
  const notices: string[] = [];
  if (missingChains.length) {
    notices.push("Google Mapsに未登録、または店舗情報の更新が遅れている可能性があります。");
  }

  if (input.mode === "facility") {
    const results = missingChains.length
      ? []
      : (await buildGoogleFacilityResults(
          stores,
          input.chains.map((chain) => chain.id),
          env,
        ))
          .sort((a, b) =>
            haversineMeters(input.center, a.coordinate) - haversineMeters(input.center, b.coordinate))
          .slice(0, 20);
    if (!missingChains.length && results.length === 0) {
      notices.push("すべてのチェーンに共通する入居施設情報は見つかりませんでした。");
    }
    return {
      mode: input.mode,
      results: publicResults(results),
      missingChains,
      analyzedAt: new Date().toISOString(),
      notices,
    };
  }

  if (missingChains.length) {
    return {
      mode: input.mode,
      results: [],
      missingChains,
      analyzedAt: new Date().toISOString(),
      notices,
    };
  }

  // Google charges Matrix per element, so limit this provider to 25 carefully
  // pre-ranked candidates (a single 625-element matrix at most).
  const candidates = pruneWalkingCandidates(stores, input.center, 5, 25);
  const matrix = await googleWalkingMatrix(candidates.map((store) => store.coordinate), env);
  const results = solveWalkingRoutes(candidates, matrix.durations, input.maxWalkMinutes! * 60, {
    maxResults: 10,
    distanceMatrix: matrix.distances,
  });
  if (results.length === 0) {
    notices.push("指定時間内に徒歩で回れる組み合わせは見つかりませんでした。経路が到達不能な場合もあります。");
  }
  return {
    mode: input.mode,
    results: publicResults(results),
    missingChains,
    analyzedAt: new Date().toISOString(),
    notices,
  };
}

function parseRouteRequest(value: unknown): RouteRequest {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).stops)) {
    throw new HttpProblem(400, "INVALID_REQUEST", "stops を指定してください。");
  }
  const stops = (value as { stops: unknown[] }).stops;
  if (stops.length < 2 || stops.length > 5) {
    throw new HttpProblem(400, "INVALID_REQUEST", "経由店舗は2〜5件指定してください。");
  }
  const parsed = stops.map((stop, index) => {
    if (!stop || typeof stop !== "object") throw new HttpProblem(400, "INVALID_REQUEST", `stops[${index}] が不正です。`);
    const item = stop as Record<string, unknown>;
    return {
      id: nonEmptyString(item.id, `stops[${index}].id`, 150),
      name: nonEmptyString(item.name, `stops[${index}].name`, 150),
      coordinate: position(item.coordinate, `stops[${index}].coordinate`),
    };
  });
  if (new Set(parsed.map((stop) => stop.id)).size !== parsed.length) {
    throw new HttpProblem(400, "INVALID_REQUEST", "同じ店舗を経路内で重複して指定できません。");
  }
  return { stops: parsed };
}

async function dispatch(request: Request, env: Env, headers: Headers): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (path === "/api/config" && request.method === "GET") {
    return json(runtimeConfig(env), headers);
  }
  if (path === "/api/chains" && request.method === "GET") {
    const query = url.searchParams.get("q") ?? "";
    if (query.length > 100) throw new HttpProblem(400, "INVALID_QUERY", "検索語は100文字以内で指定してください。");
    return json(findChains(query), headers);
  }
  if (path === "/api/geocode" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 200) throw new HttpProblem(400, "INVALID_QUERY", "住所検索語を1〜200文字で指定してください。");
    return json(await geocodeGooglePlaces(query, env), headers);
  }
  if (path === "/api/search" && request.method === "POST") {
    return json(await handleSearch(request, env), headers);
  }
  if (path === "/api/route" && request.method === "POST") {
    const input = parseRouteRequest(await requestJson(request));
    const coordinates = input.stops.map((stop) => stop.coordinate);
    return json(await googleWalkingRoute(coordinates, env), headers);
  }
  if (["/api/config", "/api/chains", "/api/geocode", "/api/search", "/api/route"].includes(path)) {
    throw new HttpProblem(405, "METHOD_NOT_ALLOWED", "このHTTPメソッドは利用できません。", false);
  }
  throw new HttpProblem(404, "NOT_FOUND", "APIエンドポイントが見つかりません。", false);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    let headers: Headers;
    try {
      headers = corsHeaders(request, env);
    } catch (error) {
      return problemResponse(asProblem(error), API_HEADERS);
    }
    try {
      return await dispatch(request, env, headers);
    } catch (error) {
      return problemResponse(asProblem(error), headers);
    }
  },
};

export default worker;

export { parseRouteRequest, parseSearchRequest };

import { findChains } from "@shop-overlap/chain-catalog";

import { parseRouteRequest, parseSearchRequest } from "./domain/request-validation";
import type { Env } from "./env";
import { asProblem, HttpProblem, problemResponse } from "./http/problem";
import { requestJson } from "./http/request-body";
import { geocodeGooglePlaces } from "./providers/google/places";
import { googleWalkingRoute } from "./providers/google/routes";
import { search } from "./services/search";

const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const API_PATHS = ["/api/chains", "/api/geocode", "/api/search", "/api/route"];

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: API_HEADERS });
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (path === "/api/chains" && request.method === "GET") {
    const query = url.searchParams.get("q") ?? "";
    if (query.length > 100) {
      throw new HttpProblem(400, "INVALID_QUERY", "検索語は100文字以内で指定してください。");
    }
    return json(findChains(query));
  }
  if (path === "/api/geocode" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 200) {
      throw new HttpProblem(400, "INVALID_QUERY", "住所検索語を1〜200文字で指定してください。");
    }
    return json(await geocodeGooglePlaces(query, env));
  }
  if (path === "/api/search" && request.method === "POST") {
    return json(await search(parseSearchRequest(await requestJson(request)), env));
  }
  if (path === "/api/route" && request.method === "POST") {
    const input = parseRouteRequest(await requestJson(request));
    return json(await googleWalkingRoute(input.stops.map((stop) => stop.coordinate), env));
  }
  if (API_PATHS.includes(path)) {
    throw new HttpProblem(405, "METHOD_NOT_ALLOWED", "このHTTPメソッドは利用できません。", false);
  }
  throw new HttpProblem(404, "NOT_FOUND", "APIエンドポイントが見つかりません。", false);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await dispatch(request, env);
    } catch (error) {
      return problemResponse(asProblem(error), API_HEADERS);
    }
  },
};

export default worker;

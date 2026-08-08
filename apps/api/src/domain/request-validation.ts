import type { ChainInput, Position, RouteRequest, SearchRequest } from "@shop-overlap/api-contract";

import { HttpProblem } from "../http/problem";
import {
  MAX_SEARCH_RADIUS_METERS,
  MAX_WALK_MINUTES,
  MIN_SEARCH_RADIUS_METERS,
  MIN_WALK_MINUTES,
  SEARCH_RADIUS_STEP_METERS,
  WALK_MINUTES_STEP,
} from "./search-constraints";

const JAPAN_BOUNDS = [122, 20, 154, 46] as const;

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

export function parseSearchRequest(value: unknown): SearchRequest {
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

export function parseRouteRequest(value: unknown): RouteRequest {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).stops)) {
    throw new HttpProblem(400, "INVALID_REQUEST", "stops を指定してください。");
  }
  const stops = (value as { stops: unknown[] }).stops;
  if (stops.length < 2 || stops.length > 5) {
    throw new HttpProblem(400, "INVALID_REQUEST", "経由店舗は2〜5件指定してください。");
  }
  const parsed = stops.map((stop, index) => {
    if (!stop || typeof stop !== "object") {
      throw new HttpProblem(400, "INVALID_REQUEST", `stops[${index}] が不正です。`);
    }
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

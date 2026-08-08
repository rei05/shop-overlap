import type { SearchRequest, SearchResponse, Store } from "@shop-overlap/api-contract";

import { haversineMeters } from "../domain/geo";
import { pruneWalkingCandidates, solveWalkingRoutes } from "../domain/walking";
import type { Env } from "../env";
import {
  buildGoogleFacilityResults,
  searchGoogleChainStores,
} from "../providers/google/places";
import { googleWalkingMatrix } from "../providers/google/routes";

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

export async function search(input: SearchRequest, env: Env): Promise<SearchResponse> {
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

  // Google charges Matrix per element, so keep the provider request to one
  // carefully pre-ranked 25×25 matrix at most.
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

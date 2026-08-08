import type { Position, Store, WalkingResult } from "@shop-overlap/api-contract";
import { haversineMeters, meanCoordinate } from "./geo";

export type DurationMatrix = ReadonlyArray<ReadonlyArray<number | null>>;

export interface WalkingSolverOptions {
  maxResults?: number;
  distanceMatrix?: DurationMatrix;
}

type PathState = {
  duration: number;
  indices: number[];
};

/** Keep nearest candidates while retaining representation from every chain. */
export function pruneWalkingCandidates(
  stores: Store[],
  center: Position,
  perChainLimit = 10,
  totalLimit = 50,
): Store[] {
  if (!Number.isInteger(perChainLimit) || perChainLimit < 1) {
    throw new Error("Per-chain limit must be a positive integer");
  }
  if (!Number.isInteger(totalLimit) || totalLimit < 1) {
    throw new Error("Total limit must be a positive integer");
  }
  const groups = new Map<string, Store[]>();
  for (const store of stores) {
    const group = groups.get(store.chainId) ?? [];
    group.push(store);
    groups.set(store.chainId, group);
  }
  if (totalLimit < groups.size) {
    throw new Error("Total limit must allow at least one store from every chain");
  }
  const rankedGroups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chainId, group]) => ({
      chainId,
      stores: group
        .map((store) => {
          const otherGroups = [...groups.entries()].filter(([otherChainId]) => otherChainId !== chainId);
          const nearestByOtherChain = otherGroups.map(([, otherStores]) =>
            Math.min(...otherStores.map((other) => haversineMeters(store.coordinate, other.coordinate))),
          );
          return {
            store,
            clusterRadius: nearestByOtherChain.length ? Math.max(...nearestByOtherChain) : 0,
            clusterTotal: nearestByOtherChain.reduce((sum, distance) => sum + distance, 0),
            centerDistance: haversineMeters(center, store.coordinate),
          };
        })
        .sort(
          (a, b) =>
            a.clusterRadius - b.clusterRadius ||
            a.clusterTotal - b.clusterTotal ||
            a.centerDistance - b.centerDistance ||
            a.store.id.localeCompare(b.store.id),
        )
        .slice(0, perChainLimit),
    }));

  // Round-robin selection prevents a dense chain from consuming the global cap.
  const selected: Store[] = [];
  for (let rank = 0; selected.length < totalLimit; rank += 1) {
    let added = false;
    for (const group of rankedGroups) {
      const candidate = group.stores[rank];
      if (candidate && selected.length < totalLimit) {
        selected.push(candidate.store);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

function validateMatrix(matrix: DurationMatrix, size: number, label: string): void {
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) {
    throw new Error(`${label} must be a square matrix matching the stores`);
  }
  for (const row of matrix) {
    for (const value of row) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${label} contains an invalid value`);
      }
    }
  }
}

function pushBest(states: PathState[], candidate: PathState, limit: number): void {
  const signature = [...candidate.indices].sort((a, b) => a - b).join(",");
  const duplicateIndex = states.findIndex(
    (state) => [...state.indices].sort((a, b) => a - b).join(",") === signature,
  );
  if (duplicateIndex >= 0) {
    if (states[duplicateIndex].duration <= candidate.duration) return;
    states.splice(duplicateIndex, 1);
  }
  states.push(candidate);
  states.sort((a, b) => a.duration - b.duration);
  if (states.length > limit) states.length = limit;
}

function sumPathMatrix(path: number[], matrix: DurationMatrix): number | undefined {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const value = matrix[path[index - 1]][path[index]];
    if (value === null) return undefined;
    total += value;
  }
  return total;
}

/**
 * Exact k-best generalized open-path solver. It chooses exactly one store from
 * each chain, permits any start/end chain, and never adds a return-to-start leg.
 */
export function solveWalkingRoutes(
  stores: Store[],
  durationMatrix: DurationMatrix,
  maxSeconds: number,
  options: WalkingSolverOptions = {},
): WalkingResult[] {
  if (!Number.isFinite(maxSeconds) || maxSeconds < 0) {
    throw new Error("Maximum duration must be a non-negative number");
  }
  validateMatrix(durationMatrix, stores.length, "Duration matrix");
  if (options.distanceMatrix) validateMatrix(options.distanceMatrix, stores.length, "Distance matrix");
  const maxResults = options.maxResults ?? 10;
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error("Maximum results must be a positive integer");
  }

  const chainIds = [...new Set(stores.map((store) => store.chainId))];
  if (chainIds.length < 2) return [];
  const chainBits = new Map(chainIds.map((chainId, index) => [chainId, 1 << index]));
  const fullMask = (1 << chainIds.length) - 1;
  // K states per (visited chain set, last store) is sufficient for exact k-best:
  // all future edge costs depend only on the last store.
  const states = new Map<number, Map<number, PathState[]>>();
  for (let index = 0; index < stores.length; index += 1) {
    const mask = chainBits.get(stores[index].chainId)!;
    const byLast = states.get(mask) ?? new Map<number, PathState[]>();
    byLast.set(index, [{ duration: 0, indices: [index] }]);
    states.set(mask, byLast);
  }

  for (let mask = 1; mask <= fullMask; mask += 1) {
    const byLast = states.get(mask);
    if (!byLast) continue;
    for (const [lastIndex, paths] of byLast) {
      for (let nextIndex = 0; nextIndex < stores.length; nextIndex += 1) {
        const nextBit = chainBits.get(stores[nextIndex].chainId)!;
        if ((mask & nextBit) !== 0) continue;
        const edge = durationMatrix[lastIndex][nextIndex];
        if (edge === null) continue;
        const nextMask = mask | nextBit;
        const nextByLast = states.get(nextMask) ?? new Map<number, PathState[]>();
        const nextPaths = nextByLast.get(nextIndex) ?? [];
        for (const path of paths) {
          const duration = path.duration + edge;
          if (duration <= maxSeconds) {
            pushBest(nextPaths, { duration, indices: [...path.indices, nextIndex] }, maxResults);
          }
        }
        if (nextPaths.length) {
          nextByLast.set(nextIndex, nextPaths);
          states.set(nextMask, nextByLast);
        }
      }
    }
  }

  const complete = [...(states.get(fullMask)?.values() ?? [])]
    .flat()
    .sort((a, b) => a.duration - b.duration);
  // Preserve the existing result identity first: different orders and
  // orientations over the same selected stores are one result, represented by
  // their fastest directed ordering.
  const seenStoreSets = new Set<string>();
  const uniqueStoreSets = complete.filter((path) => {
    const signature = path.indices.map((index) => stores[index].id).sort().join("|");
    if (seenStoreSets.has(signature)) return false;
    seenStoreSets.add(signature);
    return true;
  });

  // Different selected store sets can still produce the same ordered start and
  // goal. Collapse those to the fastest route while keeping direction in the
  // signature; the store-set pass above may already have selected only one of
  // A -> B and B -> A when they use exactly the same stores.
  const seenEndpointPairs = new Set<string>();
  const unique = uniqueStoreSets.filter((path) => {
    const startId = stores[path.indices[0]].id;
    const goalId = stores[path.indices[path.indices.length - 1]].id;
    const signature = `${startId}>${goalId}`;
    if (seenEndpointPairs.has(signature)) return false;
    seenEndpointPairs.add(signature);
    return true;
  }).slice(0, maxResults);

  return unique.map((path) => {
    const routeStores = path.indices.map((index) => stores[index]);
    const distance = options.distanceMatrix
      ? sumPathMatrix(path.indices, options.distanceMatrix)
      : undefined;
    return {
      kind: "walking",
      id: `walking:${path.indices.map((index) => stores[index].id).join(">")}`,
      // The client replaces this provider-neutral fallback with a locality name
      // derived from the displayed map scale and the returned store metadata.
      name: "徒歩圏の店舗",
      coordinate: meanCoordinate(routeStores.map((store) => store.coordinate)),
      durationSeconds: path.duration,
      estimatedDistanceMeters: Math.round(distance ?? path.duration * 1.35),
      stores: routeStores,
    };
  });
}

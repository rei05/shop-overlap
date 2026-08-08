import { describe, expect, it } from "vitest";

import type { Position, Store } from "@shop-overlap/api-contract";
import { pruneWalkingCandidates, solveWalkingRoutes } from "./walking";

function store(id: string, chainId: string, coordinate: Position): Store {
  return { id, chainId, chainName: chainId, name: id, coordinate };
}

describe("walking search", () => {
  it("retains every chain while pruning candidates", () => {
    const stores = [
      store("a1", "a", [0.001, 0]),
      store("a2", "a", [0.002, 0]),
      store("b1", "b", [0.001, 0]),
      store("b2", "b", [0.002, 0]),
    ];
    expect(pruneWalkingCandidates(stores, [0, 0], 2, 3).map(({ id }) => id))
      .toEqual(["a1", "b1", "a2"]);
  });

  it("chooses one store per chain for the shortest open route", () => {
    const stores = [
      store("a1", "a", [0, 0]),
      store("a2", "a", [1, 0]),
      store("b1", "b", [2, 0]),
      store("c1", "c", [3, 0]),
    ];
    const matrix = [
      [0, 1, 10, 10],
      [1, 0, 2, 20],
      [10, 2, 0, 3],
      [10, 20, 3, 0],
    ];
    const [result] = solveWalkingRoutes(stores, matrix, 60);
    expect(result.stores.map(({ id }) => id)).toEqual(["a2", "b1", "c1"]);
    expect(result.durationSeconds).toBe(5);
  });
});

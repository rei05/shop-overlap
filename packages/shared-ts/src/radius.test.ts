import { describe, expect, it } from "vitest";

import type { Position } from "@shop-overlap/api-contract";
import { haversineMeters } from "./geo";
import { circleBounds, circlePolygon, pointWithinRadius } from "./radius";

describe("radius search geometry", () => {
  const tokyo: Position = [139.767, 35.681];

  it("returns a conservative bounding box for a 40km Japanese search radius", () => {
    const [west, south, east, north] = circleBounds(tokyo, 40_000);
    expect(west).toBeLessThan(tokyo[0]);
    expect(east).toBeGreaterThan(tokyo[0]);
    expect(south).toBeLessThan(tokyo[1]);
    expect(north).toBeGreaterThan(tokyo[1]);
  });

  it("uses great-circle distance for inclusion", () => {
    const sapporo: Position = [141.354, 43.062];
    const inside: Position = [141.354, 43.25];
    const outside: Position = [141.354, 43.5];
    expect(haversineMeters(sapporo, inside)).toBeLessThan(25_000);
    expect(pointWithinRadius(inside, sapporo, 25_000)).toBe(true);
    expect(pointWithinRadius(outside, sapporo, 25_000)).toBe(false);
  });

  it("creates a closed geodesic polygon", () => {
    const ring = circlePolygon(tokyo, 40_000, 64).geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring.at(-1));
  });
});

import { describe, expect, it } from "vitest";

import type { Position } from "@shop-overlap/api-contract";
import { circleBounds } from "./radius";

describe("radius search geometry", () => {
  const tokyo: Position = [139.767, 35.681];

  it("returns a conservative bounding box for a 40km Japanese search radius", () => {
    const [west, south, east, north] = circleBounds(tokyo, 40_000);
    expect(west).toBeLessThan(tokyo[0]);
    expect(east).toBeGreaterThan(tokyo[0]);
    expect(south).toBeLessThan(tokyo[1]);
    expect(north).toBeGreaterThan(tokyo[1]);
  });

});

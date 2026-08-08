import { describe, expect, it } from "vitest";

import type { Store, WalkingResult } from "@shop-overlap/api-contract";
import {
  regionGranularityForMapZoom,
  walkingRegionName,
  walkingResultDisplayName,
} from "../region-label";

function store(address?: string): Store {
  return {
    id: `store-${address ?? "unknown"}`,
    chainId: "chain",
    chainName: "チェーン",
    name: "テスト店",
    coordinate: [139.767, 35.681],
    ...(address ? { address } : {}),
  };
}

function result(stores: Store[], name = "徒歩圏の店舗"): WalkingResult {
  return {
    kind: "walking",
    id: "walking:test",
    name,
    coordinate: [139.767, 35.681],
    durationSeconds: 600,
    estimatedDistanceMeters: 800,
    stores,
  };
}

describe("walking result region labels", () => {
  it("selects prefecture, municipality, then neighborhood as the map scale grows", () => {
    expect(regionGranularityForMapZoom(8)).toBe("prefecture");
    expect(regionGranularityForMapZoom(12)).toBe("municipality");
    expect(regionGranularityForMapZoom(15)).toBe("neighborhood");

    const stores = [store("日本、〒100-0005 東京都千代田区丸の内１丁目９−１")];
    expect(walkingRegionName(stores, 8)).toBe("東京都");
    expect(walkingRegionName(stores, 12)).toBe("千代田区");
    expect(walkingRegionName(stores, 15)).toBe("丸の内");
  });

  it("uses the formatted Google address already in the store payload without a reverse-geocoding call", () => {
    const stores = [store("日本、〒100-0005 東京都千代田区丸の内１丁目９−１")];

    expect(walkingRegionName(stores, 8)).toBe("東京都");
    expect(walkingRegionName(stores, 12)).toBe("千代田区");
    expect(walkingRegionName(stores, 15)).toBe("丸の内");
  });

  it("keeps multiple municipal areas understandable and removes the numbered walking-route fallback", () => {
    const stores = [
      store("東京都千代田区丸の内"),
      store("東京都中央区銀座"),
      store("東京都港区芝公園"),
    ];
    expect(walkingRegionName(stores, 12)).toBe("千代田区・中央区ほか");
    expect(walkingResultDisplayName(result(stores, "徒歩ルート 1"), 12)).toBe("千代田区・中央区ほか");
  });

  it("removes walking-route wording when address metadata is unavailable", () => {
    expect(walkingResultDisplayName(result([store()], "東京駅周辺を徒歩で回るルート"), 13))
      .toBe("東京駅周辺");
    expect(walkingResultDisplayName(result([store()]), 13)).toBe("この周辺");
  });
});

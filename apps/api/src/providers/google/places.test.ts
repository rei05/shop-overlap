import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChainInput } from "@shop-overlap/api-contract";
import {
  buildGoogleFacilityResults,
  commonContainingPlaceIds,
  geocodeGooglePlaces,
  googlePlaceMatchesChain,
  normalizeContainingPlaceIds,
  searchGoogleChainStores,
  type GooglePlaceStore,
  type GooglePlacesEnvironment,
} from "./places";

const env: GooglePlacesEnvironment = {
  GOOGLE_MAPS_API_KEY: "google-test-key",
};

function place(
  id: string,
  name: string,
  latitude = 35,
  longitude = 139,
  containingPlaces: unknown = [],
) {
  return {
    id,
    displayName: { text: name },
    formattedAddress: `東京都 ${name}`,
    location: { latitude, longitude },
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    containingPlaces,
  };
}

function store(
  sourceId: string,
  chainId: string,
  containingPlaceIds: string[],
): GooglePlaceStore {
  return {
    id: `google:${sourceId}:${chainId}`,
    sourceId,
    chainId,
    chainName: chainId,
    name: chainId,
    coordinate: [139, 35],
    mapUri: `https://maps.google.com/?cid=${sourceId}`,
    containingPlaceIds,
    sourceAttributions: [],
  } as GooglePlaceStore;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google Places client", () => {
  it("requires a server-side API key before calling Google", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeGooglePlaces("未設定キーの地点", {})).rejects.toMatchObject({
      status: 503,
      code: "GOOGLE_PLACES_NOT_CONFIGURED",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes Japanese address and station text search results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      places: [place("tokyo-station", "東京駅", 35.6812, 139.7671)],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeGooglePlaces("  東京駅テスト  ", env)).resolves.toEqual([{
      id: "google:tokyo-station",
      label: "東京都 東京駅",
      coordinate: [139.7671, 35.6812],
    }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("google-test-key");
    const fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
    expect(fieldMask).toContain("places.location");
    expect(fieldMask).toContain("places.attributions");
    expect(fieldMask).not.toContain("*");
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: "東京駅テスト",
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 5,
    });
  });

  it("preserves required third-party data attributions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      places: [{
        ...place("attributed-place", "帰属付き地点"),
        attributions: [{ provider: "Example Data", providerUri: "https://example.com/data" }],
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeGooglePlaces("帰属付き地点テスト", env)).resolves.toEqual([
      expect.objectContaining({
        sourceAttributions: [{ provider: "Example Data", providerUri: "https://example.com/data" }],
      }),
    ]);
  });

  it("normalizes current and resource-name parent Place IDs", () => {
    expect(normalizeContainingPlaceIds([
      { id: "mall-id" },
      { placeId: "station-id" },
      { place: "places/campus-id" },
      { name: "places/building-id" },
      "places/mall-id",
      null,
    ])).toEqual(["mall-id", "station-id", "campus-id", "building-id"]);
  });

  it("matches localized branch names against chain names and aliases", () => {
    const chain: ChainInput = {
      id: "starbucks",
      name: "スターバックス",
      aliases: ["Starbucks Coffee"],
    };
    expect(googlePlaceMatchesChain("スターバックス コーヒー 丸の内店", chain)).toBe(true);
    expect(googlePlaceMatchesChain("STARBUCKS COFFEE Tokyo", chain)).toBe(true);
    expect(googlePlaceMatchesChain("丸の内ビルディング", chain)).toBe(false);
  });

  it("paginates, filters to the radius, deduplicates and preserves containing Places", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(Response.json({
        places: [
          place("alpha-1", "Alpha 東京店", 35, 139, [{ id: "mall-1" }]),
          place("unrelated", "別の店舗", 35, 139),
          place("outside", "Alpha 遠方店", 36, 140),
        ],
        nextPageToken: "page-2",
      }))
      .mockResolvedValueOnce(Response.json({
        places: [
          place("alpha-1", "Alpha 東京店", 35, 139, [{ id: "mall-1" }]),
          place("alpha-2", "Alpha 駅前店", 35.001, 139.001, [{ place: "places/mall-1" }]),
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const stores = await searchGoogleChainStores(
      [139, 35],
      20_000,
      [{ id: "alpha-chain", name: "Alpha" }],
      env,
    );

    expect(stores.map((item) => item.sourceId)).toEqual(["alpha-1", "alpha-2"]);
    expect(stores[0]).toMatchObject({
      sourceId: "alpha-1",
      mapUri: "https://maps.google.com/?cid=alpha-1",
      containingPlaceIds: ["mall-1"],
      address: "東京都 Alpha 東京店",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondPageBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondPageBody).toMatchObject({
      textQuery: "Alpha",
      pageToken: "page-2",
      locationRestriction: {
        rectangle: {
          low: { latitude: expect.any(Number), longitude: expect.any(Number) },
          high: { latitude: expect.any(Number), longitude: expect.any(Number) },
        },
      },
    });
    expect(secondPageBody).not.toHaveProperty("locationBias");
  });

  it("returns only explicit parent Places shared by every chain", () => {
    const stores = [
      store("a-1", "a", ["building", "mall"]),
      store("a-2", "a", ["other"]),
      store("b-1", "b", ["building", "mall"]),
      store("c-1", "c", ["mall"]),
    ];

    expect(commonContainingPlaceIds(stores, ["a", "b"])).toEqual(["building", "mall"]);
    expect(commonContainingPlaceIds(stores, ["a", "b", "c"])).toEqual(["mall"]);
  });

  it("loads common parent Place details without inventing a facility polygon", async () => {
    const stores = [
      store("alpha-store", "alpha", ["shared-mall"]),
      store("beta-store", "beta", ["shared-mall"]),
    ];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ...place("shared-mall", "共有モール", 35.01, 139.02),
      types: ["shopping_mall"],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await buildGoogleFacilityResults(stores, ["alpha", "beta"], env);

    expect(results).toEqual([expect.objectContaining({
      kind: "facility",
      id: "google-facility:shared-mall",
      name: "共有モール",
      coordinate: [139.02, 35.01],
      stores,
    })]);
    expect(results[0]).not.toHaveProperty("facility");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/places/shared-mall");
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).not.toContain("*");
  });

  it.each([
    { status: 429, code: "GOOGLE_PLACES_RATE_LIMITED", retryable: true },
    { status: 403, code: "GOOGLE_PLACES_AUTH_ERROR", retryable: false },
  ])("maps Google HTTP $status to $code", async ({ status, code, retryable }) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream error", { status }),
    ));

    await expect(geocodeGooglePlaces(`HTTP障害${status}`, env)).rejects.toMatchObject({
      status: 503,
      code,
      retryable,
    });
  });

  it("maps timeouts to a retryable structured problem", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    ));

    await expect(geocodeGooglePlaces("タイムアウト地点", env)).rejects.toMatchObject({
      status: 504,
      code: "GOOGLE_PLACES_TIMEOUT",
      retryable: true,
    });
  });

  it("rejects malformed JSON and malformed Place coordinates", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(Response.json({ places: [place("bad-coordinate", "不正", 999, 139)] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeGooglePlaces("壊れたJSON地点", env)).rejects.toMatchObject({
      code: "GOOGLE_PLACES_INVALID_RESPONSE",
    });
    await expect(geocodeGooglePlaces("壊れた座標地点", env)).rejects.toMatchObject({
      code: "GOOGLE_PLACES_INVALID_RESPONSE",
    });
  });
});

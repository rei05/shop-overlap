import type { Store, WalkingResult } from "@shop-overlap/api-contract";

export type RegionGranularity = "prefecture" | "municipality" | "neighborhood";

type AddressParts = Partial<Record<RegionGranularity, string>>;

function clean(value: string | undefined): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function stripPrefecture(value: string): { prefecture?: string; rest: string } {
  const match = /(?:北海道|東京都|京都府|大阪府|.{2,3}県)/.exec(value);
  if (!match || match.index === undefined) return { rest: value };
  return {
    prefecture: match[0],
    rest: value.slice(match.index + match[0].length),
  };
}

function addressParts(value: string | undefined): AddressParts {
  const address = clean(value)
    ?.replace(/^日本[、,\s]*/, "")
    .replace(/〒?\d{3}-?\d{4}\s*/, "");
  if (!address) return {};

  const { prefecture, rest } = stripPrefecture(address);
  let remaining = rest;
  let municipality: string | undefined;

  const city = /^(.+?市)(.*)$/.exec(remaining);
  if (city) {
    municipality = city[1];
    remaining = city[2];
    const ward = /^(.+?区)(.*)$/.exec(remaining);
    if (ward) {
      municipality += ward[1];
      remaining = ward[2];
    }
  } else {
    const ward = /^(.+?区)(.*)$/.exec(remaining);
    const townOrVillage = /^(.+?[町村])(.*)$/.exec(remaining);
    const match = ward ?? townOrVillage;
    if (match) {
      municipality = match[1];
      remaining = match[2];
    }
  }

  const neighborhood = clean(remaining
    .replace(/^[、,\s]+/, "")
    .replace(/(?:\d|[０-９]|[一二三四五六七八九十]+丁目|丁目|番地?|号|[-−ー]).*$/, ""));
  return {
    ...(prefecture ? { prefecture } : {}),
    ...(municipality ? { municipality } : {}),
    ...(neighborhood ? { neighborhood } : {}),
  };
}

function storeAddressParts(store: Store): AddressParts {
  return addressParts(store.address);
}

/** Select a useful Japanese administrative-name granularity for the current map scale. */
export function regionGranularityForMapZoom(zoom: number): RegionGranularity {
  if (!Number.isFinite(zoom)) return "municipality";
  if (zoom < 10.5) return "prefecture";
  if (zoom < 14) return "municipality";
  return "neighborhood";
}

function firstAvailablePart(parts: AddressParts, granularity: RegionGranularity): string | undefined {
  const fallbackOrder: Record<RegionGranularity, RegionGranularity[]> = {
    prefecture: ["prefecture", "municipality", "neighborhood"],
    municipality: ["municipality", "prefecture", "neighborhood"],
    neighborhood: ["neighborhood", "municipality", "prefecture"],
  };
  return fallbackOrder[granularity].map((level) => parts[level]).find(Boolean);
}

/**
 * Builds a short region label only from store metadata already returned by the
 * selected provider. It deliberately performs no reverse-geocoding request.
 */
export function walkingRegionName(stores: Store[], zoom: number): string | undefined {
  const granularity = regionGranularityForMapZoom(zoom);
  const names = [...new Set(stores
    .map((store) => firstAvailablePart(storeAddressParts(store), granularity))
    .filter((name): name is string => Boolean(name)))];
  if (names.length === 0) return undefined;
  return names.length <= 2 ? names.join("・") : `${names.slice(0, 2).join("・")}ほか`;
}

function fallbackRegionName(value: string): string {
  const name = value.trim();
  if (/^(?:徒歩ルート\s*\d+|徒歩圏の店舗|徒歩で回るルート)$/.test(name)) {
    return "この周辺";
  }
  return name.replace(/を?徒歩で回る(?:ルート)?$/, "") || "この周辺";
}

/** Region-only result-card name that tracks the current map zoom. */
export function walkingResultDisplayName(result: WalkingResult, zoom: number): string {
  const region = walkingRegionName(result.stores, zoom);
  return region ?? fallbackRegionName(result.name);
}

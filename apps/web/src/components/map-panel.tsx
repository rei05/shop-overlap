"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef } from "react";

import type {
  Position,
  RouteResponse,
  RuntimeConfig,
  SearchResult,
} from "@shop-overlap/api-contract";
import { circleBounds } from "@shop-overlap/shared-ts";

export type MapResultFocusRequest = { resultId: string; sequence: number };
export type MapCenterFocusRequest = { coordinate: Position; sequence: number };

type Props = {
  config: RuntimeConfig | null;
  configError: string | null;
  center: Position;
  radiusMeters: number;
  results: SearchResult[];
  selectedResult: SearchResult | null;
  route: RouteResponse["route"] | null;
  onMapClick: (position: Position) => void;
  onSelectResult: (id: string) => void;
  onMapZoomChange: (zoom: number) => void;
  resultFocusRequest: MapResultFocusRequest | null;
  centerFocusRequest: MapCenterFocusRequest | null;
};

export function MapPanel({ config, configError, ...props }: Props) {
  if (configError) {
    return <MapUnavailable message={configError} radiusMeters={props.radiusMeters} />;
  }
  if (!config) {
    return <MapUnavailable message="地図を読み込んでいます…" radiusMeters={props.radiusMeters} />;
  }
  if (!config.googleMapsBrowserApiKey || !config.googleMapsMapId) {
    return <MapUnavailable message="Google Mapsの表示設定が不足しています。" radiusMeters={props.radiusMeters} />;
  }
  return (
    <GoogleMapPanel
      {...props}
      apiKey={config.googleMapsBrowserApiKey}
      mapId={config.googleMapsMapId}
    />
  );
}

function MapUnavailable({ message, radiusMeters }: { message: string; radiusMeters: number }) {
  return (
    <section className="map-panel" aria-label="検索結果の地図" data-search-radius-meters={radiusMeters}>
      <div className="map-canvas map-unavailable" role="status">{message}</div>
    </section>
  );
}

let googleLoaderKey: string | null = null;

async function loadGoogleMaps(apiKey: string): Promise<{
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}> {
  if (googleLoaderKey && googleLoaderKey !== apiKey) {
    throw new Error("Google MapsのAPIキーがページ内で変更されました。ページを再読み込みしてください。");
  }
  if (!googleLoaderKey) {
    googleLoaderKey = apiKey;
    setOptions({
      key: apiKey,
      v: "weekly",
      language: "ja",
      region: "JP",
      authReferrerPolicy: "origin",
    });
  }
  const [maps, marker] = await Promise.all([
    importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
  ]);
  return { maps, marker };
}

function googlePosition([longitude, latitude]: Position): google.maps.LatLngLiteral {
  return { lat: latitude, lng: longitude };
}

function storeMarkerLabel(index: number): string {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function markerContent(
  className: string,
  label: string,
  ariaLabel: string,
  kind: "result" | "store",
): HTMLElement {
  const element = document.createElement(kind === "result" ? "button" : "div");
  if (element instanceof HTMLButtonElement) element.type = "button";
  element.className = className;
  element.dataset.markerKind = kind;
  element.innerHTML = `<span>${label}</span>`;
  element.setAttribute("aria-label", ariaLabel);
  return element;
}

function cameraCenterAttribute(coordinate: Position): string {
  return `${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`;
}

function routeLines(route: RouteResponse["route"] | null): Position[][] {
  if (!route) return [];
  return route.features.map((feature) => feature.geometry.coordinates);
}

function GoogleMapPanel({
  apiKey,
  mapId,
  center,
  radiusMeters,
  results,
  selectedResult,
  route,
  onMapClick,
  onSelectResult,
  onMapZoomChange,
  resultFocusRequest,
  centerFocusRequest,
}: Omit<Props, "config" | "configError"> & { apiKey: string; mapId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsLibraryRef = useRef<google.maps.MapsLibrary | null>(null);
  const markerLibraryRef = useRef<google.maps.MarkerLibrary | null>(null);
  const centerMarker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const resultMarkers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const routeOverlays = useRef<google.maps.Polyline[]>([]);
  const radiusCircle = useRef<google.maps.Circle | null>(null);
  const latest = useRef({
    results,
    selectedResult,
    route,
    center,
    radiusMeters,
    resultFocusRequest,
    centerFocusRequest,
  });
  const onClick = useRef(onMapClick);
  const onSelect = useRef(onSelectResult);
  const onZoom = useRef(onMapZoomChange);
  const syncRef = useRef<(() => void) | null>(null);
  const handledResultFocus = useRef(0);
  const handledCenterFocus = useRef(0);

  useEffect(() => { onClick.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onSelect.current = onSelectResult; }, [onSelectResult]);
  useEffect(() => { onZoom.current = onMapZoomChange; }, [onMapZoomChange]);
  useEffect(() => {
    latest.current = {
      results,
      selectedResult,
      route,
      center,
      radiusMeters,
      resultFocusRequest,
      centerFocusRequest,
    };
    syncRef.current?.();
  }, [center, centerFocusRequest, radiusMeters, resultFocusRequest, results, route, selectedResult]);

  useEffect(() => {
    if (!element.current || mapRef.current) return;
    let disposed = false;
    const mapElement = element.current;

    void loadGoogleMaps(apiKey)
      .then(({ maps, marker }) => {
        if (disposed) return;
        mapsLibraryRef.current = maps;
        markerLibraryRef.current = marker;
        const map = new maps.Map(mapElement, {
          center: googlePosition(latest.current.center),
          zoom: 13,
          mapId,
          scaleControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (event.latLng) onClick.current([event.latLng.lng(), event.latLng.lat()]);
        });
        map.addListener("zoom_changed", () => onZoom.current(map.getZoom() ?? 13));
        map.addListener("idle", () => {
          const mapCenter = map.getCenter();
          if (mapCenter) {
            mapElement.parentElement?.setAttribute(
              "data-map-camera-center",
              cameraCenterAttribute([mapCenter.lng(), mapCenter.lat()]),
            );
          }
        });

        radiusCircle.current = new maps.Circle({
          map,
          center: googlePosition(latest.current.center),
          radius: latest.current.radiusMeters,
          fillColor: "#4866dc",
          fillOpacity: 0.07,
          strokeColor: "#4866dc",
          strokeOpacity: 0.8,
          strokeWeight: 2,
          clickable: false,
        });
        const centerPin = document.createElement("button");
        centerPin.type = "button";
        centerPin.className = "search-center-marker";
        centerPin.setAttribute("aria-label", "検索範囲の中心。ドラッグして移動できます");
        centerMarker.current = new marker.AdvancedMarkerElement({
          map,
          position: googlePosition(latest.current.center),
          content: centerPin,
          title: "検索範囲の中心。ドラッグして移動できます",
          gmpClickable: true,
          gmpDraggable: true,
          zIndex: 1000,
        });
        centerMarker.current.addListener("dragend", (event: google.maps.MapMouseEvent) => {
          if (event.latLng) onClick.current([event.latLng.lng(), event.latLng.lat()]);
        });
        mapRef.current = map;
        onZoom.current(map.getZoom() ?? 13);
        syncRef.current?.();
      })
      .catch((error: unknown) => {
        mapElement.textContent = error instanceof Error
          ? error.message
          : "Google Mapsを読み込めませんでした。";
      });

    return () => {
      disposed = true;
      if (centerMarker.current) centerMarker.current.map = null;
      centerMarker.current = null;
      resultMarkers.current.forEach((marker) => { marker.map = null; });
      resultMarkers.current = [];
      routeOverlays.current.forEach((overlay) => overlay.setMap(null));
      routeOverlays.current = [];
      radiusCircle.current?.setMap(null);
      radiusCircle.current = null;
      mapRef.current = null;
    };
  }, [apiKey, mapId]);

  useEffect(() => {
    syncRef.current = () => {
      const map = mapRef.current;
      const maps = mapsLibraryRef.current;
      const markerLibrary = markerLibraryRef.current;
      if (!map || !maps || !markerLibrary || !centerMarker.current) return;
      const state = latest.current;

      centerMarker.current.position = googlePosition(state.center);
      radiusCircle.current?.setCenter(googlePosition(state.center));
      radiusCircle.current?.setRadius(state.radiusMeters);

      resultMarkers.current.forEach((marker) => { marker.map = null; });
      resultMarkers.current = [];
      state.results.forEach((result, index) => {
        const content = markerContent(
          `map-marker ${state.selectedResult?.id === result.id ? "is-selected" : ""}`,
          String(index + 1),
          `${result.name}を選択`,
          "result",
        );
        const resultMarker = new markerLibrary.AdvancedMarkerElement({
          map,
          position: googlePosition(result.coordinate),
          content,
          title: `${result.name}を選択`,
          gmpClickable: true,
          zIndex: state.selectedResult?.id === result.id ? 500 : 100,
        });
        resultMarker.addListener("click", () => onSelect.current(result.id));
        resultMarkers.current.push(resultMarker);
      });
      state.selectedResult?.stores.forEach((store, index) => {
        resultMarkers.current.push(new markerLibrary.AdvancedMarkerElement({
          map,
          position: googlePosition(store.coordinate),
          content: markerContent(
            "store-marker",
            storeMarkerLabel(index),
            `${store.chainName}: ${store.name}`,
            "store",
          ),
          title: `${store.chainName}: ${store.name}`,
          zIndex: 300,
        }));
      });

      routeOverlays.current.forEach((overlay) => overlay.setMap(null));
      routeOverlays.current = routeLines(state.route).map((line) => new maps.Polyline({
        map,
        path: line.map(googlePosition),
        strokeColor: "#ec5d45",
        strokeOpacity: 0.9,
        strokeWeight: 5,
        clickable: false,
      }));

      const centerFocus = state.centerFocusRequest;
      if (centerFocus && handledCenterFocus.current !== centerFocus.sequence) {
        handledCenterFocus.current = centerFocus.sequence;
        map.panTo(googlePosition(centerFocus.coordinate));
        return;
      }
      const resultFocus = state.resultFocusRequest;
      if (resultFocus && handledResultFocus.current !== resultFocus.sequence) {
        const result = state.results.find((candidate) => candidate.id === resultFocus.resultId);
        if (result) {
          handledResultFocus.current = resultFocus.sequence;
          map.moveCamera({
            center: googlePosition(result.coordinate),
            zoom: Math.max(map.getZoom() ?? 13, 15),
          });
          return;
        }
      }
      if (!state.selectedResult) {
        const [west, south, east, north] = circleBounds(state.center, state.radiusMeters);
        map.fitBounds({ west, south, east, north }, 42);
      }
    };
    syncRef.current();
  }, []);

  return (
    <section
      className="map-panel google-map-panel"
      aria-label="検索結果の地図"
      data-search-radius-meters={radiusMeters}
      data-map-provider="google"
    >
      <div ref={element} className="map-canvas" />
      <div className="map-tip">円内が検索範囲 · クリックまたはピンのドラッグで中心を変更</div>
    </section>
  );
}

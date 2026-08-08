"use client";

import { type FocusEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, LoaderCircle, MapPin, Plus, Route, Search, X } from "lucide-react";
import Link from "next/link";
import {
  DEFAULT_CENTER,
  DEFAULT_SEARCH_RADIUS_KM,
  DEFAULT_WALK_MINUTES,
  MAX_CHAINS,
  MAX_SEARCH_RADIUS_KM,
  MAX_WALK_MINUTES,
  MIN_CHAINS,
  MIN_SEARCH_RADIUS_KM,
  MIN_WALK_MINUTES,
  WALK_MINUTES_STEP,
} from "@shop-overlap/shared-ts";
import { apiUrl } from "@/lib/api-url";
import { walkingResultDisplayName } from "@/lib/search/region-label";
import type { ApiProblem, ChainInput, ChainOption, GeocodeResult, Position, RouteResponse, RuntimeConfig, SearchMode, SearchResponse, SearchResult, SourceAttribution } from "@shop-overlap/api-contract";
import { MapPanel, type MapCenterFocusRequest, type MapResultFocusRequest } from "./map-panel";

const INITIAL_CHAINS: ChainInput[] = [
  { id: "starbucks", name: "スターバックス", wikidata: "Q37158", aliases: ["Starbucks"] },
  { id: "muji", name: "無印良品", wikidata: "Q708789", aliases: ["MUJI"] },
];

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path as `/${string}`), { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const payload = await response.json().catch(() => null) as T | ApiProblem | null;
  if (!response.ok) throw new Error((payload as ApiProblem | null)?.error?.message ?? `リクエストに失敗しました (${response.status})`);
  if (!payload) throw new Error("サーバーから有効な応答を受け取れませんでした。");
  return payload as T;
}
function message(error: unknown) { return error instanceof Error ? error.message : "通信に失敗しました。時間をおいて再度お試しください。"; }
function minutes(seconds: number) { return `${Math.max(1, Math.round(seconds / 60))}分`; }
function distance(meters: number) { return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km` : `${Math.round(meters)}m`; }
function normalizedChainName(name: string) { return name.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s　]/g, ""); }
function uniqueAttributions(attributions: SourceAttribution[]) {
  return [...new Map(attributions.map((item) => [`${item.provider}\n${item.providerUri ?? ""}`, item])).values()];
}

function SourceAttributions({ items }: { items: SourceAttribution[] }) {
  const attributions = uniqueAttributions(items);
  if (attributions.length === 0) return null;
  return <div className="source-attributions">データ提供: {attributions.map((item, index) => <span key={`${item.provider}-${item.providerUri ?? index}`}>{index > 0 && "・"}{item.providerUri ? <a href={item.providerUri} target="_blank" rel="noreferrer">{item.provider}</a> : item.provider}</span>)}</div>;
}

export function StoreOverlapApp() {
  const [chains, setChains] = useState<ChainInput[]>(INITIAL_CHAINS);
  const [chainText, setChainText] = useState("");
  const [chainOptions, setChainOptions] = useState<ChainOption[]>([]);
  const [chainSuggestionsOpen, setChainSuggestionsOpen] = useState(false);
  const [placeText, setPlaceText] = useState("東京駅");
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [placeSuggestionsOpen, setPlaceSuggestionsOpen] = useState(false);
  const [center, setCenter] = useState<Position>([...DEFAULT_CENTER]);
  const [searchRadiusKm, setSearchRadiusKm] = useState(DEFAULT_SEARCH_RADIUS_KM);
  const [mode, setMode] = useState<SearchMode>("facility");
  const [maxWalkMinutes, setMaxWalkMinutes] = useState(DEFAULT_WALK_MINUTES);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResponse["route"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(13);
  const [resultFocusRequest, setResultFocusRequest] = useState<MapResultFocusRequest | null>(null);
  const [centerFocusRequest, setCenterFocusRequest] = useState<MapCenterFocusRequest | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [runtimeConfigError, setRuntimeConfigError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const chainTimer = useRef<number | undefined>(undefined);
  const placeTimer = useRef<number | undefined>(undefined);
  const chainInputRef = useRef<HTMLInputElement>(null);
  const chainSuggestionsRef = useRef<HTMLDivElement>(null);
  const mapFocusSequence = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const results = useMemo(() => response?.results ?? [], [response]);
  const selected = useMemo(() => results.find((result) => result.id === selectedId) ?? null, [results, selectedId]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const selectResult = useCallback((id: string) => {
    if (selectedIdRef.current !== id) {
      setRoute(null);
      setRouteError(null);
    }
    selectedIdRef.current = id;
    setSelectedId(id);
  }, []);
  const selectResultFromList = useCallback((id: string) => {
    selectResult(id);
    mapFocusSequence.current += 1;
    setResultFocusRequest({ resultId: id, sequence: mapFocusSequence.current });
  }, [selectResult]);
  const mapZoomChanged = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom)) return;
    setMapZoom((previous) => Math.abs(previous - zoom) >= 0.1 ? zoom : previous);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<RuntimeConfig>("/api/config")
      .then((config) => {
        if (!cancelled) setRuntimeConfig(config);
      })
      .catch((reason) => {
        if (!cancelled) setRuntimeConfigError(message(reason));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    window.clearTimeout(chainTimer.current);
    if (!chainSuggestionsOpen || !chainText.trim()) { chainTimer.current = window.setTimeout(() => setChainOptions([]), 0); return; }
    chainTimer.current = window.setTimeout(() => {
      void fetchJson<ChainOption[]>(`/api/chains?q=${encodeURIComponent(chainText.trim())}`)
        .then((items) => setChainOptions(items.filter((item) => !chains.some((chain) => chain.id === item.id)).slice(0, 6)))
        .catch(() => setChainOptions([]));
    }, 250);
    return () => window.clearTimeout(chainTimer.current);
  }, [chainSuggestionsOpen, chainText, chains]);

  useEffect(() => {
    window.clearTimeout(placeTimer.current);
    if (!runtimeConfig || !placeSuggestionsOpen || placeText.trim().length < 2) { placeTimer.current = window.setTimeout(() => setPlaces([]), 0); return; }
    placeTimer.current = window.setTimeout(() => {
      void fetchJson<GeocodeResult[]>(`/api/geocode?q=${encodeURIComponent(placeText.trim())}`)
        .then((items) => setPlaces(items.slice(0, 5))).catch(() => setPlaces([]));
    }, 300);
    return () => window.clearTimeout(placeTimer.current);
  }, [placeSuggestionsOpen, placeText, runtimeConfig]);

  const addChain = useCallback((chain: ChainInput) => {
    if (chains.length >= MAX_CHAINS || chains.some((item) =>
      item.id === chain.id ||
      (item.wikidata && chain.wikidata && item.wikidata === chain.wikidata) ||
      normalizedChainName(item.name) === normalizedChainName(chain.name),
    )) { setChainSuggestionsOpen(false); return; }
    setChains((items) => [...items, chain]);
    setResponse(null); setSelectedId(null); setRoute(null);
    setChainText(""); setChainOptions([]); setChainSuggestionsOpen(false);
  }, [chains]);
  const addFreeChain = useCallback(() => {
    const name = chainText.trim();
    if (name) addChain({ id: `free-${name.toLocaleLowerCase("ja-JP").replace(/[^a-z0-9\\u3040-\\u30ff\\u3400-\\u9fff]+/g, "-")}`, name, aliases: [name] });
  }, [addChain, chainText]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!runtimeConfig) { setError(runtimeConfigError || "地図APIの設定を読み込んでいます。少し待って再度お試しください。"); return; }
    if (chains.length < MIN_CHAINS) { setError("チェーンを2件以上選択してください。"); return; }
    setChainSuggestionsOpen(false); setPlaceSuggestionsOpen(false);
    setError(null); setRouteError(null); setRoute(null); setResultFocusRequest(null); setSearching(true);
    try {
      const data = await fetchJson<SearchResponse>("/api/search", { method: "POST", body: JSON.stringify({ center, radiusMeters: searchRadiusKm * 1_000, chains, mode, maxWalkMinutes: mode === "walking" ? maxWalkMinutes : undefined }) });
      setResponse(data);
      if (data.results[0]) selectResult(data.results[0].id);
      else setSelectedId(null);
    } catch (reason) {
      setResponse(null); setSelectedId(null); setError(message(reason));
    } finally { setSearching(false); }
  };

  useEffect(() => {
    if (!selected || selected.kind !== "walking") return;
    let cancelled = false;
    void fetchJson<RouteResponse>("/api/route", { method: "POST", body: JSON.stringify({ stops: selected.stores.map(({ id, name, coordinate }) => ({ id, name, coordinate })) }) })
      .then((data) => { if (!cancelled) setRoute(data.route); })
      .catch((reason) => { if (!cancelled) setRouteError(`経路を表示できません: ${message(reason)}`); });
    return () => { cancelled = true; };
  }, [selected]);

  const locate = () => {
    if (!navigator.geolocation) { setError("このブラウザでは現在地を取得できません。"); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (current) => {
        const currentPosition: Position = [current.coords.longitude, current.coords.latitude];
        setCenter(currentPosition);
        mapFocusSequence.current += 1;
        setCenterFocusRequest({ coordinate: currentPosition, sequence: mapFocusSequence.current });
        setPlaceText("現在地");
        setPlaces([]);
        setPlaceSuggestionsOpen(false);
        setLocating(false);
      },
      () => { setError("現在地を取得できませんでした。ブラウザの位置情報許可を確認してください。"); setLocating(false); },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };
  const mapClick = (position: Position) => { setCenter(position); setPlaceText("地図上の地点"); setPlaces([]); setPlaceSuggestionsOpen(false); };
  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>, close: () => void) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  };
  const focusChainSuggestion = useCallback((index: number) => {
    const suggestions = chainSuggestionsRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    if (!suggestions?.length) return;
    const wrappedIndex = ((index % suggestions.length) + suggestions.length) % suggestions.length;
    suggestions[wrappedIndex].focus();
  }, []);
  const enterFreeChain = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setChainSuggestionsOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && (chainOptions.length > 0 || Boolean(chainText.trim()))) {
      event.preventDefault();
      setChainSuggestionsOpen(true);
      window.requestAnimationFrame(() => focusChainSuggestion(0));
      return;
    }
    if (event.key === "Enter" && chainOptions.length === 0) { event.preventDefault(); addFreeChain(); }
  };
  const navigateChainSuggestion = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    select: () => void,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusChainSuggestion(index + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      select();
      window.requestAnimationFrame(() => chainInputRef.current?.focus());
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      chainInputRef.current?.focus();
      setChainSuggestionsOpen(false);
    }
  };

  return <main className="app-shell">
    <aside className="side-panel">
      <header className="app-header"><span className="eyebrow">SHOP OVERLAP</span><h1>まとめて寄れる<br />店検索</h1><p>指定したチェーンがすべて入居する施設や、徒歩圏内にそろう場所を検索できます。</p></header>
      <form className="search-form" onSubmit={search}>
        <fieldset><legend>行きたいチェーン <span>{chains.length}/{MAX_CHAINS}</span></legend>
          <div className="chip-list" aria-label="選択中のチェーン">{chains.map((chain) => <span key={chain.id} className="chain-chip">{chain.name}<button type="button" onClick={() => { setChains((items) => items.filter((item) => item.id !== chain.id)); setResponse(null); setSelectedId(null); setRoute(null); }} aria-label={chain.name + "を削除"}><X size={14} /></button></span>)}</div>
          {chains.length < MAX_CHAINS && <div className="combobox-wrap" onBlur={(event) => closeWhenFocusLeaves(event, () => setChainSuggestionsOpen(false))}><div className="input-with-icon"><Search size={17} /><input ref={chainInputRef} data-testid="chain-input" role="combobox" value={chainText} onFocus={() => setChainSuggestionsOpen(true)} onChange={(event) => { setChainText(event.target.value); setChainSuggestionsOpen(true); }} onKeyDown={enterFreeChain} placeholder="チェーン名を追加" aria-label="チェーン名を追加" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="chain-suggestions" aria-expanded={chainSuggestionsOpen && Boolean(chainOptions.length > 0 || chainText.trim())} /></div>
            {chainSuggestionsOpen && (chainOptions.length > 0 || chainText.trim()) && <div ref={chainSuggestionsRef} id="chain-suggestions" className="suggestions" role="listbox" aria-label="チェーン候補">{chainOptions.map((option, index) => <button key={option.id} type="button" role="option" aria-selected="false" onClick={() => addChain(option)} onKeyDown={(event) => navigateChainSuggestion(event, index, () => addChain(option))}><span>{option.name}</span>{option.category && <small>{option.category}</small>}</button>)}{chainText.trim() && <button type="button" role="option" aria-selected="false" className="free-entry" onClick={addFreeChain} onKeyDown={(event) => navigateChainSuggestion(event, chainOptions.length, addFreeChain)}><Plus size={15} />「{chainText.trim()}」を追加</button>}</div>}
          </div>}
          <p className="field-hint">候補にないチェーンも名前を入力して検索できます。</p></fieldset>
        <fieldset><legend>探すエリア</legend>
          <div className="place-row"><div className="combobox-wrap grow" onBlur={(event) => closeWhenFocusLeaves(event, () => setPlaceSuggestionsOpen(false))}><div className="input-with-icon"><MapPin size={17} /><input data-testid="location-input" role="combobox" value={placeText} onFocus={() => setPlaceSuggestionsOpen(true)} onChange={(event) => { setPlaceText(event.target.value); setPlaceSuggestionsOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setPlaceSuggestionsOpen(false); }} placeholder="駅名・住所を入力" aria-label="検索地点" aria-autocomplete="list" aria-controls="place-suggestions" aria-expanded={placeSuggestionsOpen && places.length > 0} /></div>
            {placeSuggestionsOpen && places.length > 0 && <div className="suggestions"><div id="place-suggestions" role="listbox">{places.map((place) => <button key={place.id} type="button" role="option" aria-selected="false" onClick={() => { setCenter(place.coordinate); setPlaceText(place.label); setPlaces([]); setPlaceSuggestionsOpen(false); }}><span>{place.label}</span>{place.locality && <small>{place.locality}</small>}</button>)}</div><SourceAttributions items={places.flatMap((place) => place.sourceAttributions ?? [])} /></div>}
          </div><button className="icon-button" type="button" onClick={locate} disabled={locating} aria-label="現在地を使う">{locating ? <LoaderCircle className="spin" size={18} /> : <Crosshair size={18} />}</button></div>
          <label className="range-label search-radius-range">検索半径 <output aria-hidden="true">{searchRadiusKm} km</output><input data-testid="search-radius" type="range" min={MIN_SEARCH_RADIUS_KM} max={MAX_SEARCH_RADIUS_KM} step="1" value={searchRadiusKm} onChange={(event) => setSearchRadiusKm(Number(event.target.value))} aria-label="検索半径" aria-valuetext={`${searchRadiusKm} km`} /></label>
          <p className="field-hint viewport-hint" aria-live="polite">地図をクリックするかピンをドラッグして中心を決め、半径{searchRadiusKm}kmを検索します。</p></fieldset>
        <fieldset><legend>探し方</legend><div className="mode-toggle" role="radiogroup" aria-label="探し方">
          <button data-testid="mode-facility" type="button" role="radio" aria-checked={mode === "facility"} className={mode === "facility" ? "active" : ""} onClick={() => { setMode("facility"); setResponse(null); setSelectedId(null); setRoute(null); }}><span>同じ施設</span><small>同一建物・モール内</small></button>
          <button data-testid="mode-walking" type="button" role="radio" aria-checked={mode === "walking"} className={mode === "walking" ? "active" : ""} onClick={() => { setMode("walking"); setResponse(null); setSelectedId(null); setRoute(null); }}><span>徒歩圏</span><small>最短で順に回れる</small></button>
        </div>{mode === "walking" && <label className="range-label walk-range">店舗を回る上限 <output>{maxWalkMinutes} 分</output><input data-testid="walk-minutes" type="range" min={MIN_WALK_MINUTES} max={MAX_WALK_MINUTES} step={WALK_MINUTES_STEP} value={maxWalkMinutes} onChange={(event) => { setMaxWalkMinutes(Number(event.target.value)); setResponse(null); setSelectedId(null); setRoute(null); }} /></label>}</fieldset>
        <button data-testid="search-submit" className="search-button" type="submit" disabled={searching || chains.length < MIN_CHAINS}>{searching ? <><LoaderCircle className="spin" size={19} /> 探しています…</> : <><Search size={19} /> この条件で探す</>}</button>
      </form>
      <Results response={response} results={results} selected={selected} onSelectResult={selectResultFromList} error={runtimeConfigError || error} routeError={routeError} mapZoom={mapZoom} />
      <footer className="app-footer"><Link href="/terms/">利用規約</Link><Link href="/privacy/">プライバシーポリシー</Link><span className="google-maps-attribution" translate="no">Google Maps</span></footer>
    </aside>
    <MapPanel config={runtimeConfig} configError={runtimeConfigError} center={center} radiusMeters={searchRadiusKm * 1_000} results={results} selectedResult={selected} route={route} onMapClick={mapClick} onSelectResult={selectResultFromList} onMapZoomChange={mapZoomChanged} resultFocusRequest={resultFocusRequest} centerFocusRequest={centerFocusRequest} />
  </main>;
}

function Results({ response, results, selected, onSelectResult, error, routeError, mapZoom }: { response: SearchResponse | null; results: SearchResult[]; selected: SearchResult | null; onSelectResult: (id: string) => void; error: string | null; routeError: string | null; mapZoom: number }) {
  const sourceAttributions = results.flatMap((result) => [
    ...(result.kind === "facility" ? result.sourceAttributions ?? [] : []),
    ...result.stores.flatMap((store) => store.sourceAttributions ?? []),
  ]);
  return <section className="result-section" aria-live="polite">
    {error && <div className="message error-message" role="alert">{error}</div>}
    {response && <>{response.notices.map((notice) => <div className="message notice-message" key={notice}>{notice}</div>)}
      {response.missingChains.length > 0 && <div className="message notice-message">{response.missingChains.join("・")} の店舗を見つけられませんでした。<a href="https://www.google.com/maps" target="_blank" rel="noreferrer">Googleマップで確認</a></div>}
      {results.length === 0 ? <div className="empty-state"><Search size={24} /><p>条件に合う場所は見つかりませんでした。</p><small>中心ピンを移動する、チェーン名を見直すなどをお試しください。</small></div> : <><div className="result-heading"><strong>{results.length}件見つかりました</strong><span>{response.mode === "facility" ? "共通の施設" : "徒歩で回る順"}</span></div><div className="result-list">{results.map((result, index) => <button data-testid="result-card" type="button" key={result.id} className={`result-card ${selected?.id === result.id ? "selected" : ""}`} onClick={() => onSelectResult(result.id)}><span className="result-number">{index + 1}</span><span className="result-main"><strong>{result.kind === "walking" ? walkingResultDisplayName(result, mapZoom) : result.name}</strong><small>{result.kind === "facility" ? result.stores.length + "店舗 · 同じ施設内" : <><Route size={13} /> {minutes(result.durationSeconds)} · {distance(result.estimatedDistanceMeters)}</>}</small><span className="store-names">{result.stores.map((store) => store.chainName).join(" → ")}</span></span></button>)}</div></>}
    </>}
    {!response && !error && <div className="empty-state initial-state"><MapPin size={24} /><p>条件を入力して検索を始めましょう。</p><small>地図をクリックして検索地点を決めることもできます。</small></div>}
    {routeError && <div className="message notice-message">{routeError}</div>}
    {response && <SourceAttributions items={sourceAttributions} />}
  </section>;
}

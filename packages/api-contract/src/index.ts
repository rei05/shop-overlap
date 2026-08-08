import type { components } from "./openapi.generated";

/** Ergonomic application types projected from the generated OpenAPI schema. */
export type ApiProblem = components["schemas"]["ApiProblem"];
export type ChainInput = components["schemas"]["ChainInput"];
export type ChainOption = components["schemas"]["ChainOption"];
export type FacilityResult = components["schemas"]["FacilityResult"];
export type GeocodeResult = components["schemas"]["GeocodeResult"];
export type Position = components["schemas"]["Position"];
export type RouteRequest = components["schemas"]["RouteRequest"];
export type RouteResponse = components["schemas"]["RouteResponse"];
export type RouteStop = components["schemas"]["RouteStop"];
export type SearchMode = components["schemas"]["SearchMode"];
export type SearchRequest = components["schemas"]["SearchRequest"];
export type SearchResponse = components["schemas"]["SearchResponse"];
export type SearchResult = components["schemas"]["SearchResult"];
export type SourceAttribution = components["schemas"]["SourceAttribution"];
export type Store = components["schemas"]["Store"];
export type WalkingResult = components["schemas"]["WalkingResult"];

export type { components, operations, paths } from "./openapi.generated";

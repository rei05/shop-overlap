# ShopOverlap API contract

`Sources/ShopOverlapAPI/openapi.yaml` is the canonical HTTP contract for both
TypeScript applications and the iOS client. The Swift package uses Apple's
Swift OpenAPI Generator build plugin; generated sources remain in SwiftPM's
build directory and are deliberately not committed.

Coordinates on the wire are always `[longitude, latitude]`. `Coordinate` is a
small hand-written facade for converting that order to `CLLocationCoordinate2D`.

`src/openapi.generated.ts` is produced by `openapi-typescript`; do not edit it.
`src/index.ts` exposes stable, ergonomic aliases for application code. Use
`npm run generate --workspace @shop-overlap/api-contract` after changing the
specification, and `npm run check:generated --workspace @shop-overlap/api-contract`
in CI to detect drift without modifying the checked-in generated file.

The generator is pinned to an exact version so checked-in output is stable.

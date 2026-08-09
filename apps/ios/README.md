# ShopOverlap for iOS

SwiftUI client for iOS 17 and later. Places and Routes requests go through the
Worker API; the only client-side Google credential is the bundle-restricted
Maps SDK for iOS key.

## Local setup

1. Copy `Config/Secrets.xcconfig.example` to `Config/Secrets.xcconfig`.
2. Add an iOS-restricted Google Maps key, the Worker base URL, and the public
   legal-site base URL.
3. Open `ShopOverlap.xcodeproj`. Xcode resolves Google Maps SDK 10.15.0 through
   Swift Package Manager.
4. Run `npm run ios:dev` from the repository root. It starts the Worker, creates
   or reuses the `ShopOverlap iPhone` simulator, builds, installs, and launches
   the app. Press Ctrl+C when finished to stop the Worker.

If the Worker is already running, use `npm run ios:run` to rebuild and relaunch
only the Simulator app.

The launcher preserves the Simulator's existing location, including a location
set in Simulator's **Features > Location > Custom Location**. To set a location
for a launch explicitly, use `SHOP_OVERLAP_SIMULATOR_LOCATION=latitude,longitude`,
for example `SHOP_OVERLAP_SIMULATOR_LOCATION=35.6586,139.7454 npm run ios:run`.

The app target links the local `../../packages/api-contract` package. API models
mirror its public OpenAPI contract, and `APIRepository` validates coordinate wire
order through `ShopOverlapAPI`. The repository remains the only transport boundary,
so its temporary URLSession mapping can be replaced by the generated `Client`
without changing features or views.

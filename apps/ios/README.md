# ShopOverlap for iOS

SwiftUI client for iOS 17 and later. Places and Routes requests go through the
shared Worker API; the only client-side Google credential is the bundle-restricted
Maps SDK for iOS key.

## Local setup

1. Copy `Config/Secrets.xcconfig.example` to `Config/Secrets.xcconfig`.
2. Add an iOS-restricted Google Maps key and the Worker base URL.
3. Open `ShopOverlap.xcodeproj`. Xcode resolves Google Maps SDK 10.15.0 through
   Swift Package Manager.
4. Start the Worker on port 8787 for the default Debug configuration, then run
   the `ShopOverlap` scheme.

The app target links the local `../../packages/api-contract` package. API models
mirror its public OpenAPI contract, and `APIRepository` validates coordinate wire
order through `ShopOverlapAPI`. The repository remains the only transport boundary,
so its temporary URLSession mapping can be replaced by the generated `Client`
without changing features or views.

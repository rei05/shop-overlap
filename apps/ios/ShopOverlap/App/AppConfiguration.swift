import Foundation

struct AppConfiguration: Sendable {
    let apiBaseURL: URL
    let googleMapsAPIKey: String?

    init(bundle: Bundle = .main) {
        let baseURLString = bundle.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        apiBaseURL = URL(string: baseURLString ?? "http://localhost:8787")
            ?? URL(string: "http://localhost:8787")!

        let key = (bundle.object(forInfoDictionaryKey: "GOOGLE_MAPS_IOS_API_KEY") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        googleMapsAPIKey = key.flatMap { value in
            value.isEmpty || value.hasPrefix("replace-") ? nil : value
        }
    }
}

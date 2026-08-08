import CoreLocation
import Foundation

/// A named representation of the API's `[longitude, latitude]` tuple.
struct Coordinate: Codable, Hashable, Sendable {
    let longitude: Double
    let latitude: Double

    init(longitude: Double, latitude: Double) {
        self.longitude = longitude
        self.latitude = latitude
    }

    init(_ location: CLLocationCoordinate2D) {
        self.init(longitude: location.longitude, latitude: location.latitude)
    }

    var clLocationCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        longitude = try container.decode(Double.self)
        latitude = try container.decode(Double.self)
        guard container.isAtEnd,
              (-180 ... 180).contains(longitude),
              (-90 ... 90).contains(latitude) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Coordinate must be [longitude, latitude]."
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(longitude)
        try container.encode(latitude)
    }
}

enum SearchMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case facility
    case walking

    var id: Self { self }
    var title: String { self == .facility ? "同じ施設" : "徒歩で回る" }
}

struct ChainInput: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let wikidata: String?
    let aliases: [String]?
}

struct ChainOption: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let wikidata: String?
    let aliases: [String]?
    let category: String?

    var input: ChainInput {
        ChainInput(id: id, name: name, wikidata: wikidata, aliases: aliases)
    }
}

struct SourceAttribution: Codable, Hashable, Sendable {
    let provider: String
    let providerUri: URL?
}

struct GeocodeResult: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let label: String
    let coordinate: Coordinate
    let locality: String?
    let sourceAttributions: [SourceAttribution]?
}

struct Store: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let chainId: String
    let chainName: String
    let name: String
    let coordinate: Coordinate
    let address: String?
    let mapUri: URL?
    let sourceAttributions: [SourceAttribution]?
}

struct SearchRequest: Codable, Sendable {
    let center: Coordinate
    let radiusMeters: Int
    let chains: [ChainInput]
    let mode: SearchMode
    let maxWalkMinutes: Int?
}

struct SearchResult: Codable, Hashable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable {
        case facility
        case walking
    }

    let kind: Kind
    let id: String
    let name: String
    let subtitle: String?
    let coordinate: Coordinate
    let durationSeconds: Double?
    let estimatedDistanceMeters: Double?
    let stores: [Store]
    let sourceAttributions: [SourceAttribution]?

    var detail: String {
        switch kind {
        case .facility:
            return "\(stores.count)店舗・同じ施設内"
        case .walking:
            let minutes = max(1, Int(((durationSeconds ?? 0) / 60).rounded()))
            let meters = Int((estimatedDistanceMeters ?? 0).rounded())
            let distance = meters >= 1_000
                ? String(format: "%.1f km", Double(meters) / 1_000)
                : "\(meters)m"
            return "徒歩約\(minutes)分・\(distance)"
        }
    }
}

struct SearchResponse: Codable, Sendable {
    let mode: SearchMode
    let results: [SearchResult]
    let missingChains: [String]
    let analyzedAt: Date
    let notices: [String]
}

struct RouteStop: Codable, Sendable {
    let id: String
    let name: String
    let coordinate: Coordinate
}

struct RouteRequest: Codable, Sendable {
    let stops: [RouteStop]
}

struct RouteResponse: Codable, Sendable {
    let route: GeoJSONFeatureCollection
    let distanceMeters: Double
    let durationSeconds: Double
}

struct GeoJSONFeatureCollection: Codable, Sendable {
    let type: String
    let features: [GeoJSONFeature]

    var lineCoordinates: [Coordinate] {
        features.flatMap(\.geometry.coordinates)
    }
}

struct GeoJSONFeature: Codable, Sendable {
    let type: String
    let geometry: GeoJSONLineString
}

struct GeoJSONLineString: Codable, Sendable {
    let type: String
    let coordinates: [Coordinate]
}

struct ApiProblem: Codable, Error, Sendable {
    struct Detail: Codable, Sendable {
        let code: String
        let message: String
        let retryable: Bool
    }

    let error: Detail
}

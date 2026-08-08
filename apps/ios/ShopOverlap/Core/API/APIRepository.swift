import Foundation
import ShopOverlapAPI

protocol SearchRepository: Sendable {
    func chains(matching query: String) async throws -> [ChainOption]
    func geocode(_ query: String) async throws -> [GeocodeResult]
    func search(_ request: SearchRequest) async throws -> SearchResponse
    func route(stops: [RouteStop]) async throws -> RouteResponse
}

struct APIRepository: SearchRepository {
    let client: APIClient

    func chains(matching query: String) async throws -> [ChainOption] {
        try await client.get(
            path: "/api/chains",
            queryItems: [URLQueryItem(name: "q", value: query)]
        )
    }

    func geocode(_ query: String) async throws -> [GeocodeResult] {
        try await client.get(
            path: "/api/geocode",
            queryItems: [URLQueryItem(name: "q", value: query)]
        )
    }

    func search(_ request: SearchRequest) async throws -> SearchResponse {
        // Validate the wire order through the shared contract facade. The UI never handles arrays.
        _ = try ShopOverlapAPI.Coordinate(wireValue: [
            request.center.longitude,
            request.center.latitude,
        ])
        return try await client.post(path: "/api/search", body: request)
    }

    func route(stops: [RouteStop]) async throws -> RouteResponse {
        try await client.post(path: "/api/route", body: RouteRequest(stops: stops))
    }
}

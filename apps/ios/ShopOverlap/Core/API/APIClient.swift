import Foundation

protocol HTTPClient: Sendable {
    func send<Response: Decodable & Sendable>(
        _ request: URLRequest,
        as type: Response.Type
    ) async throws -> Response
}

enum APIClientError: LocalizedError, Sendable {
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "サーバーから有効な応答を受け取れませんでした。"
        case let .httpStatus(status):
            "リクエストに失敗しました（\(status)）。"
        }
    }
}

struct URLSessionHTTPClient: HTTPClient {
    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession = .shared) {
        self.session = session
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO 8601 timestamp: \(value)"
            )
        }
    }

    func send<Response: Decodable & Sendable>(
        _ request: URLRequest,
        as type: Response.Type
    ) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            if let problem = try? decoder.decode(ApiProblem.self, from: data) {
                throw problem
            }
            throw APIClientError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }
}

struct APIClient: Sendable {
    let baseURL: URL
    let httpClient: any HTTPClient

    init(baseURL: URL, httpClient: any HTTPClient = URLSessionHTTPClient()) {
        self.baseURL = baseURL
        self.httpClient = httpClient
    }

    func get<Response: Decodable & Sendable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        as type: Response.Type = Response.self
    ) async throws -> Response {
        var components = URLComponents(url: endpoint(path), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else { throw URLError(.badURL) }
        return try await httpClient.send(request(url: url), as: type)
    }

    func post<Body: Encodable, Response: Decodable & Sendable>(
        path: String,
        body: Body,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        var request = request(url: endpoint(path))
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(body)
        return try await httpClient.send(request, as: type)
    }

    private func endpoint(_ path: String) -> URL {
        baseURL.appending(path: path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    private func request(url: URL) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
}

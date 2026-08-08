import XCTest
@testable import ShopOverlap

@MainActor
final class SearchViewModelTests: XCTestCase {
    func testSearchSelectsFirstResult() async {
        let expected = SearchResult(
            kind: .facility,
            id: "facility-1",
            name: "テストモール",
            subtitle: nil,
            coordinate: Coordinate(longitude: 139.7, latitude: 35.6),
            durationSeconds: nil,
            estimatedDistanceMeters: nil,
            stores: [],
            sourceAttributions: nil
        )
        let repository = RepositoryStub(response: SearchResponse(
            mode: .facility,
            results: [expected],
            missingChains: [],
            analyzedAt: .now,
            notices: []
        ))
        let model = SearchViewModel(
            repository: repository,
            locationProvider: LocationStub(result: .success(Coordinate(longitude: 1, latitude: 2)))
        )

        await model.search()

        XCTAssertEqual(model.results, [expected])
        XCTAssertEqual(model.selectedResultID, expected.id)
    }

    func testDeniedCurrentLocationIsPresented() async {
        let model = SearchViewModel(
            repository: RepositoryStub(response: .empty),
            locationProvider: LocationStub(result: .failure(LocationError.denied))
        )

        await model.useCurrentLocation()

        XCTAssertEqual(model.errorMessage, LocationError.denied.errorDescription)
    }

    func testSuccessfulEmptySearchRecordsCompletedState() async {
        let model = SearchViewModel(
            repository: RepositoryStub(response: .empty),
            locationProvider: LocationStub(result: .success(Coordinate(longitude: 1, latitude: 2)))
        )

        await model.search()

        XCTAssertTrue(model.hasCompletedSearch)
        XCTAssertTrue(model.results.isEmpty)
    }

    func testSearchRequiresAConfirmedPlace() async {
        let model = SearchViewModel(
            repository: RepositoryStub(response: .empty),
            locationProvider: LocationStub(result: .success(Coordinate(longitude: 1, latitude: 2)))
        )

        model.placeQuery = "新宿駅"
        await model.search()

        XCTAssertFalse(model.isPlaceConfirmed)
        XCTAssertFalse(model.hasCompletedSearch)
        XCTAssertNotNil(model.errorMessage)
    }
}

private extension SearchResponse {
    static var empty: Self {
        SearchResponse(mode: .facility, results: [], missingChains: [], analyzedAt: .now, notices: [])
    }
}

private struct RepositoryStub: SearchRepository {
    let response: SearchResponse

    func chains(matching query: String) async throws -> [ChainOption] { [] }
    func geocode(_ query: String) async throws -> [GeocodeResult] { [] }
    func search(_ request: SearchRequest) async throws -> SearchResponse { response }
    func route(stops: [RouteStop]) async throws -> RouteResponse { throw CancellationError() }
}

@MainActor
private final class LocationStub: LocationProviding {
    let result: Result<Coordinate, Error>

    init(result: Result<Coordinate, Error>) { self.result = result }
    func currentCoordinate() async throws -> Coordinate { try result.get() }
}

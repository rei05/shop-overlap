import XCTest
@testable import ShopOverlap

final class APIModelTests: XCTestCase {
    func testCoordinateDecodesLongitudeBeforeLatitude() throws {
        let coordinate = try JSONDecoder().decode(Coordinate.self, from: Data("[139.7671,35.6812]".utf8))

        XCTAssertEqual(coordinate.longitude, 139.7671, accuracy: 0.000_001)
        XCTAssertEqual(coordinate.latitude, 35.6812, accuracy: 0.000_001)
    }

    func testCoordinateEncodesInAPIOrder() throws {
        let data = try JSONEncoder().encode(Coordinate(longitude: 135.5, latitude: 34.7))
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [Double])

        XCTAssertEqual(values, [135.5, 34.7])
    }

    func testProblemPreservesRetryableState() throws {
        let data = Data(#"{"error":{"code":"RATE_LIMITED","message":"後で再試行","retryable":true}}"#.utf8)
        let problem = try JSONDecoder().decode(ApiProblem.self, from: data)

        XCTAssertEqual(problem.error.code, "RATE_LIMITED")
        XCTAssertTrue(problem.error.retryable)
    }
}

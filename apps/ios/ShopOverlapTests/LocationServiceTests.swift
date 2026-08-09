import CoreLocation
import XCTest
@testable import ShopOverlap

@MainActor
final class LocationServiceTests: XCTestCase {
    func testNotDeterminedWaitsForAuthorizationBeforeRequestingLocation() async throws {
        let manager = LocationManagerStub(authorizationStatus: .notDetermined)
        let service = LocationService(manager: manager)

        let coordinateTask = Task { try await service.currentCoordinate() }
        await Task.yield()

        XCTAssertEqual(manager.authorizationRequestCount, 1)
        XCTAssertEqual(manager.locationRequestCount, 0)

        manager.authorizationStatus = .authorizedWhenInUse
        manager.sendAuthorizationChange()

        XCTAssertEqual(manager.locationRequestCount, 1)

        let expected = CLLocationCoordinate2D(latitude: 35.6812, longitude: 139.7671)
        manager.sendLocation(expected)
        let coordinate = try await coordinateTask.value
        XCTAssertEqual(coordinate, Coordinate(expected))
    }

    func testDeniedCoreLocationErrorIsPresentedAsDenied() async {
        let manager = LocationManagerStub(authorizationStatus: .authorizedWhenInUse)
        let service = LocationService(manager: manager)

        let coordinateTask = Task { try await service.currentCoordinate() }
        await Task.yield()
        manager.sendError(CLError(.denied))

        await XCTAssertLocationError(.denied, from: coordinateTask)
    }

    func testRestrictedAuthorizationIsPreservedWhenLocationFails() async {
        let manager = LocationManagerStub(authorizationStatus: .authorizedWhenInUse)
        let service = LocationService(manager: manager)

        let coordinateTask = Task { try await service.currentCoordinate() }
        await Task.yield()
        manager.authorizationStatus = .restricted
        manager.sendError(CLError(.locationUnknown))

        await XCTAssertLocationError(.restricted, from: coordinateTask)
    }

    func testCanRetryAfterTransientLocationFailure() async throws {
        let manager = LocationManagerStub(authorizationStatus: .authorizedWhenInUse)
        let service = LocationService(manager: manager)

        let firstTask = Task { try await service.currentCoordinate() }
        await Task.yield()
        manager.sendError(CLError(.locationUnknown))
        await XCTAssertLocationError(.unavailable, from: firstTask)

        let retryTask = Task { try await service.currentCoordinate() }
        await Task.yield()
        XCTAssertEqual(manager.locationRequestCount, 2)

        let expected = CLLocationCoordinate2D(latitude: 34.7025, longitude: 135.4959)
        manager.sendLocation(expected)
        let coordinate = try await retryTask.value
        XCTAssertEqual(coordinate, Coordinate(expected))
    }

    private func XCTAssertLocationError(
        _ expected: LocationError,
        from task: Task<Coordinate, Error>,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await task.value
            XCTFail("Expected location request to fail", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? LocationError, expected, file: file, line: line)
        }
    }
}

@MainActor
private final class LocationManagerStub: LocationManaging {
    var authorizationStatus: CLAuthorizationStatus
    weak var delegate: CLLocationManagerDelegate?
    var desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBest
    private(set) var authorizationRequestCount = 0
    private(set) var locationRequestCount = 0

    private let delegateManager = CLLocationManager()

    init(authorizationStatus: CLAuthorizationStatus) {
        self.authorizationStatus = authorizationStatus
    }

    func requestWhenInUseAuthorization() {
        authorizationRequestCount += 1
    }

    func requestLocation() {
        locationRequestCount += 1
    }

    func sendAuthorizationChange() {
        delegate?.locationManagerDidChangeAuthorization?(delegateManager)
    }

    func sendLocation(_ coordinate: CLLocationCoordinate2D) {
        delegate?.locationManager?(delegateManager, didUpdateLocations: [CLLocation(
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        )])
    }

    func sendError(_ error: Error) {
        delegate?.locationManager?(delegateManager, didFailWithError: error)
    }
}

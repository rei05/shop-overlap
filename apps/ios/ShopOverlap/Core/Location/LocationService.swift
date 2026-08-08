import CoreLocation
import Foundation
import Observation

enum LocationError: LocalizedError, Equatable {
    case denied
    case restricted
    case unavailable

    var errorDescription: String? {
        switch self {
        case .denied:
            "位置情報が許可されていません。設定アプリから許可してください。"
        case .restricted:
            "この端末では位置情報を利用できません。"
        case .unavailable:
            "現在地を取得できませんでした。"
        }
    }
}

@MainActor
protocol LocationProviding: AnyObject {
    func currentCoordinate() async throws -> Coordinate
}

@Observable
@MainActor
final class LocationService: NSObject, LocationProviding, CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private var continuation: CheckedContinuation<Coordinate, Error>?

    override init() {
        manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func currentCoordinate() async throws -> Coordinate {
        guard continuation == nil else { throw LocationError.unavailable }
        switch manager.authorizationStatus {
        case .denied:
            throw LocationError.denied
        case .restricted:
            throw LocationError.restricted
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            break
        @unknown default:
            throw LocationError.unavailable
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else {
            finish(with: .failure(LocationError.unavailable))
            return
        }
        finish(with: .success(Coordinate(location.coordinate)))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(with: .failure(LocationError.unavailable))
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied:
            finish(with: .failure(LocationError.denied))
        case .restricted:
            finish(with: .failure(LocationError.restricted))
        case .notDetermined:
            break
        @unknown default:
            finish(with: .failure(LocationError.unavailable))
        }
    }

    private func finish(with result: Result<Coordinate, Error>) {
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(with: result)
    }
}

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

@MainActor
protocol LocationManaging: AnyObject {
    var authorizationStatus: CLAuthorizationStatus { get }
    var delegate: CLLocationManagerDelegate? { get set }
    var desiredAccuracy: CLLocationAccuracy { get set }

    func requestWhenInUseAuthorization()
    func requestLocation()
}

extension CLLocationManager: LocationManaging {}

@Observable
@MainActor
final class LocationService: NSObject, LocationProviding, @preconcurrency CLLocationManagerDelegate {
    private let manager: any LocationManaging
    private var continuation: CheckedContinuation<Coordinate, Error>?

    override convenience init() {
        self.init(manager: CLLocationManager())
    }

    init(manager: any LocationManaging) {
        self.manager = manager
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
            break
        case .authorizedAlways, .authorizedWhenInUse:
            break
        @unknown default:
            throw LocationError.unavailable
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedAlways, .authorizedWhenInUse:
                manager.requestLocation()
            case .denied:
                finish(with: .failure(LocationError.denied))
            case .restricted:
                finish(with: .failure(LocationError.restricted))
            @unknown default:
                finish(with: .failure(LocationError.unavailable))
            }
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
        finish(with: .failure(locationError(for: error)))
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        switch self.manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            self.manager.requestLocation()
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

    private func locationError(for error: Error) -> LocationError {
        switch manager.authorizationStatus {
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        default:
            break
        }

        if let coreLocationError = error as? CLError, coreLocationError.code == .denied {
            return .denied
        }
        return .unavailable
    }
}

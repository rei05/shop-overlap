import CoreLocation

/// Keeps the wire protocol's `[longitude, latitude]` order out of UI code.
public struct Coordinate: Equatable, Sendable {
    public let longitude: Double
    public let latitude: Double

    public init(longitude: Double, latitude: Double) {
        self.longitude = longitude
        self.latitude = latitude
    }

    public init(wireValue: [Double]) throws {
        guard wireValue.count == 2 else { throw CoordinateError.invalidWireValue }
        self.init(longitude: wireValue[0], latitude: wireValue[1])
    }

    public var wireValue: [Double] { [longitude, latitude] }
    public var clLocationCoordinate2D: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

public enum CoordinateError: Error, Equatable, Sendable {
    case invalidWireValue
}

import GoogleMaps
import SwiftUI
import UIKit

struct GoogleMapView: UIViewRepresentable {
    let center: Coordinate
    let results: [SearchResult]
    let selectedResultID: String?
    let routeCoordinates: [Coordinate]
    let onMapTap: (Coordinate) -> Void
    let onResultTap: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onMapTap: onMapTap, onResultTap: onResultTap)
    }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        options.camera = GMSCameraPosition.camera(
            withLatitude: center.latitude,
            longitude: center.longitude,
            zoom: 12
        )
        let mapView = GMSMapView(options: options)
        mapView.delegate = context.coordinator
        mapView.settings.compassButton = true
        mapView.settings.myLocationButton = false
        mapView.isBuildingsEnabled = true
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        context.coordinator.onMapTap = onMapTap
        context.coordinator.onResultTap = onResultTap
        mapView.clear()

        let centerMarker = GMSMarker(position: center.clLocationCoordinate)
        centerMarker.title = "検索の中心"
        centerMarker.icon = GMSMarker.markerImage(with: .systemBlue)
        centerMarker.map = mapView

        for (index, result) in results.enumerated() {
            let marker = GMSMarker(position: result.coordinate.clLocationCoordinate)
            marker.title = result.name
            marker.snippet = result.detail
            marker.userData = result.id
            marker.icon = GMSMarker.markerImage(
                with: result.id == selectedResultID ? .systemRed : .systemOrange
            )
            marker.zIndex = Int32(results.count - index)
            marker.map = mapView
        }

        if let selected = results.first(where: { $0.id == selectedResultID }) {
            for store in selected.stores {
                let marker = GMSMarker(position: store.coordinate.clLocationCoordinate)
                marker.title = store.name
                marker.snippet = store.chainName
                marker.icon = GMSMarker.markerImage(with: .systemGreen)
                marker.map = mapView
            }
        }

        if routeCoordinates.count >= 2 {
            let path = GMSMutablePath()
            routeCoordinates.forEach { path.add($0.clLocationCoordinate) }
            let polyline = GMSPolyline(path: path)
            polyline.strokeColor = .systemBlue
            polyline.strokeWidth = 5
            polyline.geodesic = true
            polyline.map = mapView
        }

        let focusKey = "\(center.longitude),\(center.latitude):\(selectedResultID ?? "none"):route\(routeCoordinates.count)"
        guard context.coordinator.lastFocusKey != focusKey else { return }
        context.coordinator.lastFocusKey = focusKey
        focusMap(mapView)
    }

    private func focusMap(_ mapView: GMSMapView) {
        var coordinates = routeCoordinates
        if coordinates.isEmpty, let selected = results.first(where: { $0.id == selectedResultID }) {
            coordinates = [selected.coordinate] + selected.stores.map(\.coordinate)
        }
        guard coordinates.count >= 2 else {
            let target = coordinates.first ?? center
            mapView.animate(to: GMSCameraPosition.camera(
                withLatitude: target.latitude,
                longitude: target.longitude,
                zoom: results.isEmpty ? 12 : 14
            ))
            return
        }

        var bounds = GMSCoordinateBounds()
        coordinates.forEach { bounds = bounds.includingCoordinate($0.clLocationCoordinate) }
        mapView.animate(with: GMSCameraUpdate.fit(bounds, withPadding: 64))
    }

    final class Coordinator: NSObject, GMSMapViewDelegate {
        var onMapTap: (Coordinate) -> Void
        var onResultTap: (String) -> Void
        var lastFocusKey: String?

        init(
            onMapTap: @escaping (Coordinate) -> Void,
            onResultTap: @escaping (String) -> Void
        ) {
            self.onMapTap = onMapTap
            self.onResultTap = onResultTap
        }

        func mapView(_ mapView: GMSMapView, didTapAt coordinate: CLLocationCoordinate2D) {
            onMapTap(Coordinate(coordinate))
        }

        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            if let id = marker.userData as? String { onResultTap(id) }
            return false
        }
    }
}

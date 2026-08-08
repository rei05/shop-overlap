import SwiftUI

@main
struct ShopOverlapApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model: SearchViewModel

    init() {
        let configuration = AppConfiguration()
        let repository = APIRepository(
            client: APIClient(baseURL: configuration.apiBaseURL)
        )
        _model = State(initialValue: SearchViewModel(
            repository: repository,
            locationProvider: LocationService()
        ))
    }

    var body: some Scene {
        WindowGroup {
            SearchScreen(model: model)
        }
    }
}

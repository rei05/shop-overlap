import SwiftUI

struct SearchScreen: View {
    @Bindable var model: SearchViewModel
    @State private var controlsPresented = false

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        mapContent
                        .frame(height: max(320, proxy.size.height * 0.48))
                        .accessibilityIdentifier("results-map")

                        VStack(alignment: .leading, spacing: 12) {
                            if model.results.isEmpty && !model.isSearching {
                                ContentUnavailableView(
                                    "条件を指定して検索",
                                    systemImage: "map",
                                    description: Text("地図をタップすると検索の中心を移動できます。")
                                )
                            } else {
                                Text("\(model.results.count)件見つかりました")
                                    .font(.title3.bold())
                                ResultsView(
                                    results: model.results,
                                    selectedID: model.selectedResultID,
                                    notices: model.notices,
                                    missingChains: model.missingChains,
                                    onSelect: model.selectResult
                                )
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("ShopOverlap")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { controlsPresented = true } label: {
                        Label("検索条件", systemImage: "slider.horizontal.3")
                    }
                    .accessibilityIdentifier("search-options-button")
                }
            }
            .sheet(isPresented: $controlsPresented) {
                NavigationStack {
                    ScrollView {
                        SearchControlsView(model: model) {
                            controlsPresented = false
                        }
                    }
                        .navigationTitle("検索条件")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("完了") { controlsPresented = false }
                            }
                        }
                }
                .presentationDetents([.medium, .large])
            }
            .alert("エラー", isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.dismissError() } }
            )) {
                Button("OK") { model.dismissError() }
            } message: {
                Text(model.errorMessage ?? "")
            }
            .safeAreaInset(edge: .bottom) {
                if model.results.isEmpty {
                    Button {
                        controlsPresented = true
                    } label: {
                        Label("検索条件を開く", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                    .background(.ultraThinMaterial)
                }
            }
        }
    }

    @ViewBuilder
    private var mapContent: some View {
        if AppConfiguration().googleMapsAPIKey == nil {
            ContentUnavailableView(
                "地図キーが未設定です",
                systemImage: "map",
                description: Text("Config/Secrets.xcconfig にiOS用のGoogle Mapsキーを設定してください。")
            )
            .background(Color.secondary.opacity(0.08))
        } else {
            GoogleMapView(
                center: model.center,
                results: model.results,
                selectedResultID: model.selectedResultID,
                routeCoordinates: model.route?.route.lineCoordinates ?? [],
                onMapTap: model.chooseMapCoordinate,
                onResultTap: { id in
                    if let result = model.results.first(where: { $0.id == id }) {
                        model.selectResult(result)
                    }
                }
            )
        }
    }
}

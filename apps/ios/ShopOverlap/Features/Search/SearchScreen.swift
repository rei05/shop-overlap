import SwiftUI

struct SearchScreen: View {
    @Bindable var model: SearchViewModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                VStack(spacing: 0) {
                    mapContent
                        .frame(maxWidth: .infinity)
                        .frame(height: mapHeight(for: proxy.size.height))
                        .clipped()

                    Divider()

                    ScrollView {
                        VStack(spacing: 0) {
                            SearchControlsView(model: model)

                            VStack(alignment: .leading, spacing: 12) {
                                if model.isSearching {
                                    ProgressView("重なる場所を検索しています…")
                                        .frame(maxWidth: .infinity, minHeight: 120)
                                        .accessibilityIdentifier("search-progress")
                                } else if isShowingEmptySearchResult {
                                    ContentUnavailableView(
                                        "重なる場所が見つかりませんでした",
                                        systemImage: "magnifyingglass",
                                        description: Text("検索範囲やチェーンを変えて、もう一度お試しください。")
                                    )
                                    .accessibilityIdentifier("empty-search-results")
                                } else if !model.results.isEmpty {
                                    Text("\(model.results.count)件見つかりました")
                                        .font(.title3.bold())
                                        .accessibilityAddTraits(.isHeader)
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
                        .frame(maxWidth: .infinity)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .accessibilityIdentifier("search-content-scroll")
                }
            }
            .navigationTitle("ShopOverlap")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                SearchActionView(model: model) { }
            }
            .alert("エラー", isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.dismissError() } }
            )) {
                Button("OK") { model.dismissError() }
            } message: {
                Text(model.errorMessage ?? "")
            }
        }
    }

    private var isShowingEmptySearchResult: Bool {
        model.hasCompletedSearch && model.results.isEmpty
    }

    private func mapHeight(for availableHeight: CGFloat) -> CGFloat {
        let preferredFraction = dynamicTypeSize.isAccessibilitySize ? 0.24 : 0.34
        let maximumHeight: CGFloat = dynamicTypeSize.isAccessibilitySize ? 200 : 320
        let minimumScrollableHeight: CGFloat = 132
        let minimumMapHeight: CGFloat = 96
        let maximumAvailableHeight = max(minimumMapHeight, availableHeight - minimumScrollableHeight)

        return min(
            maximumHeight,
            maximumAvailableHeight,
            max(minimumMapHeight, availableHeight * preferredFraction)
        )
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
            .accessibilityIdentifier("results-map")
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
            .accessibilityIdentifier("results-map")
            .overlay(alignment: .bottomTrailing) {
                Button {
                    Task { await model.useCurrentLocation() }
                } label: {
                    Label(
                        model.isLocating ? "現在地を取得中" : "現在地を使う",
                        systemImage: "location.fill"
                    )
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color(uiColor: .systemBackground))
                .foregroundStyle(.primary)
                .shadow(radius: 2, y: 1)
                .padding(16)
                .disabled(model.isLocating)
                .accessibilityLabel("現在地を使う")
                .accessibilityValue(model.isLocating ? "取得中" : "")
                .accessibilityHint("端末の現在地を検索の中心に設定します")
                .accessibilityIdentifier("map-current-location-button")
            }
        }
    }
}

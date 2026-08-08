import SwiftUI

struct SearchControlsView: View {
    @Bindable var model: SearchViewModel
    let onSearchCompleted: () -> Void
    private let legalBaseURL = AppConfiguration().legalBaseURL

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            placeSection
            chainSection
            optionsSection

            Button {
                Task {
                    await model.search()
                    if model.errorMessage == nil { onSearchCompleted() }
                }
            } label: {
                HStack {
                    if model.isSearching { ProgressView().tint(.white) }
                    Text(model.isSearching ? "検索中…" : "重なる場所を検索")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isSearching || model.selectedChains.count < SearchViewModel.minimumChains)
            .accessibilityIdentifier("search-button")

            if let legalBaseURL {
                HStack(spacing: 16) {
                    Link("利用規約", destination: legalBaseURL.appending(path: "terms"))
                    Link("プライバシー", destination: legalBaseURL.appending(path: "privacy"))
                }
                .font(.footnote)
                .frame(maxWidth: .infinity)
            }
        }
        .padding()
    }

    private var placeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("検索する場所", systemImage: "mappin.and.ellipse")
                .font(.headline)
            HStack {
                TextField("駅名・住所", text: $model.placeQuery)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.search)
                    .onChange(of: model.placeQuery) { _, _ in model.updatePlaceSuggestions() }
                    .accessibilityIdentifier("place-field")
                Button {
                    Task { await model.useCurrentLocation() }
                } label: {
                    if model.isLocating { ProgressView() } else { Image(systemName: "location.fill") }
                }
                .buttonStyle(.bordered)
                .disabled(model.isLocating)
                .accessibilityLabel("現在地を使う")
            }
            suggestions(model.placeSuggestions) { place in
                Button { model.choosePlace(place) } label: {
                    VStack(alignment: .leading) {
                        Text(place.label).lineLimit(2)
                        if let locality = place.locality { Text(locality).font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var chainSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("チェーン", systemImage: "building.2")
                    .font(.headline)
                Spacer()
                Text("\(model.selectedChains.count)/\(SearchViewModel.maximumChains)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(model.selectedChains) { chain in
                        HStack(spacing: 5) {
                            Text(chain.name)
                            Button { model.removeChain(chain) } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(chain.name)を削除")
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.accentColor.opacity(0.12), in: Capsule())
                    }
                }
            }
            HStack {
                TextField("チェーン名を追加", text: $model.chainQuery)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { model.addFreeformChain() }
                    .onChange(of: model.chainQuery) { _, _ in model.updateChainSuggestions() }
                    .disabled(!model.canAddChain)
                    .accessibilityIdentifier("chain-field")
                Button("追加") { model.addFreeformChain() }
                    .disabled(model.chainQuery.trimmingCharacters(in: .whitespaces).isEmpty || !model.canAddChain)
            }
            suggestions(model.chainSuggestions) { option in
                Button { model.addChain(option) } label: {
                    HStack {
                        Text(option.name)
                        Spacer()
                        if let category = option.category {
                            Text(category).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var optionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("検索方法", selection: $model.mode) {
                ForEach(SearchMode.allCases) { mode in Text(mode.title).tag(mode) }
            }
            .pickerStyle(.segmented)
            Stepper("検索半径: \(model.radiusKilometers) km", value: $model.radiusKilometers, in: 1 ... 40)
            if model.mode == .walking {
                Stepper(
                    "徒歩時間: \(model.maximumWalkMinutes)分以内",
                    value: $model.maximumWalkMinutes,
                    in: 5 ... 15,
                    step: 5
                )
            }
        }
    }

    @ViewBuilder
    private func suggestions<Item: Identifiable, Content: View>(
        _ items: [Item],
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        if !items.isEmpty {
            VStack(spacing: 0) {
                ForEach(items) { item in
                    content(item)
                        .buttonStyle(.plain)
                        .padding(10)
                    Divider()
                }
            }
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.quaternary))
        }
    }
}

import SwiftUI

struct SearchControlsView: View {
    @Bindable var model: SearchViewModel
    @State private var areOptionsExpanded = false
    private let legalBaseURL = AppConfiguration().legalBaseURL

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            placeSection
            Divider()
            chainSection
            Divider()
            optionsSection

            if let legalBaseURL {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 20) {
                        legalLinks(baseURL: legalBaseURL)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        legalLinks(baseURL: legalBaseURL)
                    }
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
            TextField("駅名・住所", text: $model.placeQuery)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .onChange(of: model.placeQuery) { _, _ in model.updatePlaceSuggestions() }
                .accessibilityLabel("検索する場所")
                .accessibilityIdentifier("place-field")
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
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("選択済みチェーン")
                    .accessibilityValue("\(model.selectedChains.count)件、最大\(SearchViewModel.maximumChains)件")
            }
            VStack(spacing: 8) {
                ForEach(model.selectedChains) { chain in
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text(chain.name)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button { model.removeChain(chain) } label: {
                            Image(systemName: "trash")
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(chain.name)を削除")
                        .accessibilityHint("選択済みチェーンから取り除きます")
                        .accessibilityIdentifier("remove-chain-\(chain.id)")
                    }
                    .padding(.leading, 12)
                    .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityElement(children: .contain)
                }
            }
            HStack(alignment: .center, spacing: 8) {
                TextField("チェーン名を追加", text: $model.chainQuery)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { model.addFreeformChain() }
                    .onChange(of: model.chainQuery) { _, _ in model.updateChainSuggestions() }
                    .disabled(!model.canAddChain)
                    .accessibilityLabel("追加するチェーン")
                    .accessibilityIdentifier("chain-field")
                Button("追加") { model.addFreeformChain() }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .disabled(model.chainQuery.trimmingCharacters(in: .whitespaces).isEmpty || !model.canAddChain)
            }
            if !model.canAddChain {
                Label("追加できるチェーンは最大\(SearchViewModel.maximumChains)件です。", systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
        VStack(alignment: .leading, spacing: 8) {
            Button {
                areOptionsExpanded.toggle()
            } label: {
                HStack {
                    Label("検索オプション", systemImage: "scope")
                        .font(.headline)
                    Spacer()
                    Image(systemName: "chevron.forward")
                        .rotationEffect(.degrees(areOptionsExpanded ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .accessibilityLabel("検索オプション")
            .accessibilityValue(areOptionsExpanded ? "展開中" : "折りたたみ中")
            .accessibilityHint(areOptionsExpanded ? "ダブルタップで折りたたみます" : "ダブルタップで展開します")
            .accessibilityIdentifier("search-options-disclosure")

            if areOptionsExpanded {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("検索方法", selection: $model.mode) {
                        ForEach(SearchMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("検索半径")
                            Spacer()
                            Text("\(model.radiusKilometers) km")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .accessibilityHidden(true)
                        }
                        Slider(
                            value: Binding(
                                get: { Double(model.radiusKilometers) },
                                set: { model.radiusKilometers = Int($0.rounded()) }
                            ),
                            in: 1 ... 40,
                            step: 1
                        )
                        .frame(minHeight: 44)
                        .accessibilityLabel("検索半径")
                        .accessibilityValue("\(model.radiusKilometers) km")
                        .accessibilityIdentifier("search-radius-slider")
                    }

                    if model.mode == .walking {
                        Stepper(
                            "徒歩時間: \(model.maximumWalkMinutes)分以内",
                            value: $model.maximumWalkMinutes,
                            in: 5 ... 15,
                            step: 5
                        )
                        .frame(minHeight: 44)
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private func legalLinks(baseURL: URL) -> some View {
        Link("利用規約", destination: baseURL.appending(path: "terms"))
            .frame(minHeight: 44)
        Link("プライバシー", destination: baseURL.appending(path: "privacy"))
            .frame(minHeight: 44)
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
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    Divider()
                }
            }
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(.quaternary))
        }
    }
}

struct SearchActionView: View {
    @Bindable var model: SearchViewModel
    let onSearchCompleted: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let guidance = searchGuidance {
                Label(guidance, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("search-requirements-message")
            }
            Button {
                Task {
                    await model.search()
                    if model.errorMessage == nil { onSearchCompleted() }
                }
            } label: {
                HStack {
                    if model.isSearching { ProgressView() }
                    Text(model.isSearching ? "検索中…" : "重なる場所を検索")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSearchDisabled)
            .frame(minHeight: 44)
            .accessibilityIdentifier("search-button")
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
    }

    private var isSearchDisabled: Bool {
        model.isSearching
            || !model.isPlaceConfirmed
            || model.selectedChains.count < SearchViewModel.minimumChains
    }

    private var searchGuidance: String? {
        if !model.isPlaceConfirmed {
            return "入力候補から場所を選択してください。"
        }
        let remaining = SearchViewModel.minimumChains - model.selectedChains.count
        guard remaining > 0 else { return nil }
        return "検索するにはチェーンをあと\(remaining)件追加してください。"
    }
}

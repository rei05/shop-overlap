import SwiftUI

struct ResultsView: View {
    let results: [SearchResult]
    let selectedID: String?
    let notices: [String]
    let missingChains: [String]
    let onSelect: (SearchResult) -> Void

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 10) {
            if !missingChains.isEmpty {
                Label("見つからなかったチェーン: \(missingChains.joined(separator: "、"))", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(notices, id: \.self) { notice in
                Label(notice, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                VStack(alignment: .leading, spacing: 0) {
                    Button { onSelect(result) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(index + 1)")
                                .font(.headline)
                                .frame(width: 30, height: 30)
                                .background(.tint.opacity(0.14), in: Circle())
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(result.name).font(.headline)
                                Text(result.detail).font(.subheadline).foregroundStyle(.secondary)
                                if !result.stores.isEmpty {
                                    Text(result.stores.map(\.chainName).joined(separator: " → "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if selectedID == result.id {
                                Label("選択中", systemImage: "checkmark.circle.fill")
                                    .labelStyle(.iconOnly)
                                    .foregroundStyle(.tint)
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(resultAccessibilityLabel(index: index, result: result))
                    .accessibilityValue(selectedID == result.id ? "選択中" : "未選択")
                    .accessibilityHint("地図でこの結果を表示します")
                    .accessibilityAddTraits(selectedID == result.id ? .isSelected : [])
                    .accessibilityIdentifier("result-card-\(index)")

                    if hasAttributions(result) {
                        Divider()
                            .padding(.horizontal, 12)
                        attributionView(result)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                    }
                }
                .background(
                    selectedID == result.id
                        ? Color.accentColor.opacity(0.10)
                        : Color.secondary.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .overlay {
                    if selectedID == result.id {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.accentColor, lineWidth: 2)
                    }
                }
            }
        }
    }

    private func resultAccessibilityLabel(index: Int, result: SearchResult) -> String {
        let chains = result.stores.map(\.chainName).joined(separator: "、")
        return chains.isEmpty
            ? "\(index + 1)番、\(result.name)、\(result.detail)"
            : "\(index + 1)番、\(result.name)、\(result.detail)、\(chains)"
    }

    private func hasAttributions(_ result: SearchResult) -> Bool {
        !(result.sourceAttributions ?? []).isEmpty
            || result.stores.contains { !($0.sourceAttributions ?? []).isEmpty }
    }

    @ViewBuilder
    private func attributionView(_ result: SearchResult) -> some View {
        let attributions = (result.sourceAttributions ?? [])
            + result.stores.flatMap { $0.sourceAttributions ?? [] }
        let unique = Dictionary(grouping: attributions, by: { $0.provider }).compactMap { $0.value.first }
        if !unique.isEmpty {
            HStack(spacing: 4) {
                Text("データ提供:")
                ForEach(unique, id: \.self) { item in
                    if let url = item.providerUri {
                        Link(item.provider, destination: url)
                    } else {
                        Text(item.provider)
                    }
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }
}

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
                Label("未検出: \(missingChains.joined(separator: "、"))", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }
            ForEach(notices, id: \.self) { notice in
                Text(notice).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                Button { onSelect(result) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(index + 1)")
                            .font(.headline)
                            .frame(width: 30, height: 30)
                            .background(.tint.opacity(0.14), in: Circle())
                        VStack(alignment: .leading, spacing: 5) {
                            Text(result.name).font(.headline)
                            Text(result.detail).font(.subheadline).foregroundStyle(.secondary)
                            Text(result.stores.map(\.chainName).joined(separator: " → "))
                                .font(.caption).foregroundStyle(.secondary)
                            attributionView(result)
                        }
                        Spacer()
                        if selectedID == result.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint) }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(selectedID == result.id ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("result-card-\(index)")
            }
        }
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

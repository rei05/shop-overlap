import Foundation
import Observation

@Observable
@MainActor
final class SearchViewModel {
    static let minimumChains = 2
    static let maximumChains = 5

    var selectedChains: [ChainInput] = [
        ChainInput(id: "starbucks", name: "スターバックス", wikidata: "Q37158", aliases: ["Starbucks"]),
        ChainInput(id: "muji", name: "無印良品", wikidata: "Q708789", aliases: ["MUJI"]),
    ]
    var chainQuery = ""
    var chainSuggestions: [ChainOption] = []
    var placeQuery = "東京駅" {
        didSet {
            guard placeQuery != oldValue else { return }
            isPlaceConfirmed = false
            clearResults()
        }
    }
    var placeSuggestions: [GeocodeResult] = []
    var center = Coordinate(longitude: 139.7671, latitude: 35.6812)
    var radiusKilometers = 20 {
        didSet { if radiusKilometers != oldValue { clearResults() } }
    }
    var mode: SearchMode = .facility {
        didSet { if mode != oldValue { clearResults() } }
    }
    var maximumWalkMinutes = 10 {
        didSet { if maximumWalkMinutes != oldValue { clearResults() } }
    }

    private(set) var results: [SearchResult] = []
    private(set) var notices: [String] = []
    private(set) var missingChains: [String] = []
    private(set) var route: RouteResponse?
    private(set) var hasCompletedSearch = false
    private(set) var isPlaceConfirmed = true
    private(set) var isSearching = false
    private(set) var isLocating = false
    private(set) var errorMessage: String?
    var selectedResultID: String?

    private let repository: any SearchRepository
    private let locationProvider: any LocationProviding
    private var chainSuggestionTask: Task<Void, Never>?
    private var placeSuggestionTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var routeTask: Task<Void, Never>?
    private var activeSearchID: UUID?

    init(repository: any SearchRepository, locationProvider: any LocationProviding) {
        self.repository = repository
        self.locationProvider = locationProvider
    }

    var selectedResult: SearchResult? {
        results.first { $0.id == selectedResultID }
    }

    var canAddChain: Bool { selectedChains.count < Self.maximumChains }

    func updateChainSuggestions() {
        chainSuggestionTask?.cancel()
        let query = chainQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, canAddChain else {
            chainSuggestions = []
            return
        }
        chainSuggestionTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let options = try await repository.chains(matching: query)
                guard !Task.isCancelled else { return }
                chainSuggestions = Array(options.filter { option in
                    !selectedChains.contains { $0.id == option.id }
                }.prefix(6))
            } catch is CancellationError {
                return
            } catch {
                chainSuggestions = []
            }
        }
    }

    func updatePlaceSuggestions() {
        placeSuggestionTask?.cancel()
        let query = placeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isPlaceConfirmed,
              query.count >= 2,
              query != "現在地",
              query != "地図上の地点" else {
            placeSuggestions = []
            return
        }
        placeSuggestionTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let places = try await repository.geocode(query)
                guard !Task.isCancelled else { return }
                placeSuggestions = Array(places.prefix(5))
            } catch is CancellationError {
                return
            } catch {
                placeSuggestions = []
            }
        }
    }

    func addChain(_ option: ChainOption) {
        guard canAddChain, !selectedChains.contains(where: { $0.id == option.id }) else { return }
        selectedChains.append(option.input)
        chainQuery = ""
        chainSuggestions = []
        clearResults()
    }

    func addFreeformChain() {
        let name = chainQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, canAddChain else { return }
        let normalized = name.folding(options: [.caseInsensitive, .widthInsensitive], locale: .current)
        guard !selectedChains.contains(where: {
            $0.name.folding(options: [.caseInsensitive, .widthInsensitive], locale: .current) == normalized
        }) else { return }
        let slug = name.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "-" }.joined()
        selectedChains.append(ChainInput(id: "free-\(slug)", name: name, wikidata: nil, aliases: [name]))
        chainQuery = ""
        chainSuggestions = []
        clearResults()
    }

    func removeChain(_ chain: ChainInput) {
        selectedChains.removeAll { $0.id == chain.id }
        clearResults()
    }

    func choosePlace(_ place: GeocodeResult) {
        placeQuery = place.label
        center = place.coordinate
        isPlaceConfirmed = true
        placeSuggestions = []
        clearResults()
    }

    func chooseMapCoordinate(_ coordinate: Coordinate) {
        center = coordinate
        placeQuery = "地図上の地点"
        isPlaceConfirmed = true
        placeSuggestions = []
        clearResults()
    }

    func useCurrentLocation() async {
        isLocating = true
        errorMessage = nil
        defer { isLocating = false }
        do {
            center = try await locationProvider.currentCoordinate()
            placeQuery = "現在地"
            isPlaceConfirmed = true
            placeSuggestions = []
            clearResults()
        } catch {
            errorMessage = readableMessage(error)
        }
    }

    func search() async {
        guard isPlaceConfirmed else {
            errorMessage = "候補から場所を選択するか、現在地または地図上の地点を指定してください。"
            return
        }
        guard selectedChains.count >= Self.minimumChains else {
            errorMessage = "チェーンを2件以上選択してください。"
            return
        }
        searchTask?.cancel()
        routeTask?.cancel()
        errorMessage = nil
        route = nil
        hasCompletedSearch = false
        isSearching = true
        let searchID = UUID()
        activeSearchID = searchID

        let request = SearchRequest(
            center: center,
            radiusMeters: radiusKilometers * 1_000,
            chains: selectedChains,
            mode: mode,
            maxWalkMinutes: mode == .walking ? maximumWalkMinutes : nil
        )
        let task = Task { try await repository.search(request) }
        searchTask = Task {
            defer {
                if activeSearchID == searchID { isSearching = false }
            }
            do {
                let response = try await withTaskCancellationHandler {
                    try await task.value
                } onCancel: {
                    task.cancel()
                }
                guard !Task.isCancelled, activeSearchID == searchID else { return }
                results = response.results
                notices = response.notices
                missingChains = response.missingChains
                hasCompletedSearch = true
                selectedResultID = response.results.first?.id
                await loadRouteForSelection()
            } catch is CancellationError {
                return
            } catch {
                guard activeSearchID == searchID else { return }
                results = []
                selectedResultID = nil
                errorMessage = readableMessage(error)
            }
        }
        await searchTask?.value
    }

    func selectResult(_ result: SearchResult) {
        selectedResultID = result.id
        route = nil
        Task { await loadRouteForSelection() }
    }

    func dismissError() {
        errorMessage = nil
    }

    private func loadRouteForSelection() async {
        routeTask?.cancel()
        guard let result = selectedResult, result.kind == .walking, result.stores.count >= 2 else {
            route = nil
            return
        }
        let stops = result.stores.map {
            RouteStop(id: $0.id, name: $0.name, coordinate: $0.coordinate)
        }
        let resultID = result.id
        routeTask = Task {
            do {
                let response = try await repository.route(stops: stops)
                guard !Task.isCancelled, selectedResultID == resultID else { return }
                route = response
            } catch is CancellationError {
                return
            } catch {
                guard selectedResultID == resultID else { return }
                errorMessage = "経路を表示できません: \(readableMessage(error))"
            }
        }
        await routeTask?.value
    }

    private func clearResults() {
        searchTask?.cancel()
        routeTask?.cancel()
        activeSearchID = nil
        isSearching = false
        results = []
        notices = []
        missingChains = []
        route = nil
        hasCompletedSearch = false
        selectedResultID = nil
    }

    private func readableMessage(_ error: Error) -> String {
        if let problem = error as? ApiProblem { return problem.error.message }
        return (error as? LocalizedError)?.errorDescription
            ?? "通信に失敗しました。時間をおいて再度お試しください。"
    }
}

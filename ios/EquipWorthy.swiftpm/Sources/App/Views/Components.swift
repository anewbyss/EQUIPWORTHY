import SwiftUI
import Charts
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

// MARK: - Save control on every screen

@MainActor
struct SaveButton: View {
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        Button {
            Task { await store.save() }
        } label: {
            if store.saving {
                ProgressView()
            } else {
                Label(store.dirty ? "Save" : "Saved", systemImage: store.dirty ? "square.and.arrow.down" : "checkmark.circle")
            }
        }
        .disabled(store.saving)
        .accessibilityHint(statusText)
    }

    var statusText: String {
        if let e = store.lastError { return e }
        if store.dirty { return "Unsaved changes" }
        guard let d = store.lastSaved else { return "Not saved yet" }
        return "Saved \(d.formatted(.relative(presentation: .named)))"
    }
}

/// Sync status + manual sync, shown next to Save once sync is set up.
@MainActor
struct SyncButton: View {
    @EnvironmentObject var sync: SyncManager

    var body: some View {
        if sync.configured {
            Button {
                Task { await sync.syncNow() }
            } label: {
                if sync.syncing { ProgressView() } else {
                    Image(systemName: sync.error != nil ? "exclamationmark.icloud" : "arrow.triangle.2.circlepath.icloud")
                        .foregroundStyle(sync.error != nil ? Theme.down : Theme.sky)
                }
            }
            .disabled(sync.syncing)
            .accessibilityLabel(sync.error ?? (sync.lastSync.map { "Synced \($0.formatted(.relative(presentation: .named)))" } ?? "Sync now"))
        }
    }
}

extension View {
    /// Adds the manual Save button (with autosave status) and sync button to a screen's toolbar.
    func saveToolbar() -> some View {
        toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                RefreshButton()
                SyncButton()
                SaveButton()
            }
        }
    }
}

// MARK: - Cards

@MainActor
struct CardImage: View {
    let url: String?
    var width: CGFloat = 60

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { img in
            img.resizable().aspectRatio(488 / 680, contentMode: .fit)
        } placeholder: {
            RoundedRectangle(cornerRadius: 4).fill(.quaternary).aspectRatio(488 / 680, contentMode: .fit)
        }
        .frame(width: width)
        .clipShape(RoundedRectangle(cornerRadius: width * 0.05))
    }
}

@MainActor
struct ChangeText: View {
    let value: Double?
    var body: some View {
        if let v = value {
            Text("\(v > 0 ? "▲" : v < 0 ? "▼" : "") \(String(format: "%.1f", abs(v)))%")
                .foregroundStyle(v > 0.05 ? Theme.up : v < -0.05 ? Theme.down : Color.secondary)
                .monospacedDigit()
        } else {
            Text("—").foregroundStyle(.secondary)
        }
    }
}

@MainActor
struct PctSlider: View {
    let label: String
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading) {
            Text("\(label): **\(Int(value))%** of market").font(.subheadline)
            Slider(value: $value, in: 0...100, step: 1)
        }
    }
}

// MARK: - Price chart (Swift Charts)

@MainActor
struct PriceChart: View {
    let series: PriceSeries
    var label = "Price"
    @State private var range = 90
    @State private var selected: Date?

    struct Point: Identifiable { let date: Date; let price: Double; var id: Date { date } }

    private var points: [Point] {
        guard let last = series.last.flatMap({ dayDate($0.date) }) else { return [] }
        return series.compactMap { p in
            guard let d = dayDate(p.date), last.timeIntervalSince(d) <= Double(range) * 86_400 else { return nil }
            return Point(date: d, price: p.price)
        }
    }

    var body: some View {
        VStack(alignment: .leading) {
            Picker("Range", selection: $range) {
                Text("7D").tag(7); Text("30D").tag(30); Text("90D").tag(90); Text("1Y").tag(365); Text("All").tag(100_000)
            }
            .pickerStyle(.segmented)
            if points.count < 2 {
                Text(series.count < 2 ? "Price history builds up as prices refresh. EquipWorthy records one snapshot per day." : "Not enough points in this range.")
                    .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 120)
            } else {
                Chart {
                    ForEach(points) { p in
                        LineMark(x: .value("Date", p.date), y: .value(label, p.price))
                            .interpolationMethod(.monotone)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .foregroundStyle(Theme.sky)
                    }
                    if let s = selected, let near = points.min(by: { abs($0.date.timeIntervalSince(s)) < abs($1.date.timeIntervalSince(s)) }) {
                        RuleMark(x: .value("Date", near.date))
                            .foregroundStyle(.secondary)
                            .annotation(position: .top, overflowResolution: .init(x: .fit, y: .disabled)) {
                                Text("\(near.date.formatted(date: .abbreviated, time: .omitted)) · \(near.price.usd)")
                                    .font(.caption).padding(4).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 6))
                            }
                    }
                }
                .chartXSelection(value: $selected)
                .chartYAxis { AxisMarks(position: .leading) { v in AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(d.usd) } } } }
                .frame(height: 200)
            }
        }
    }
}

// MARK: - Card search with Scryfall autocomplete

@MainActor
struct CardSearchField: View {
    var prompt = "Search a card…"
    let onPick: (CardSummary) -> Void
    @EnvironmentObject var store: ProfileStore
    @State private var text = ""
    @State private var suggestions: [String] = []
    @State private var task: Task<Void, Never>?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(prompt, text: $text)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .onSubmit { pick(suggestions.first ?? text) }
                .onChange(of: text) { _, q in
                    task?.cancel()
                    task = Task {
                        try? await Task.sleep(nanoseconds: 200_000_000)
                        guard !Task.isCancelled else { return }
                        let s = (try? await Scryfall.shared.autocomplete(q)) ?? OfflineCardDB.shared.names(matching: q)
                        if !Task.isCancelled { suggestions = Array(s.prefix(8)) }
                    }
                }
            ForEach(suggestions, id: \.self) { s in
                Button(s) { pick(s) }.buttonStyle(.borderless).padding(.vertical, 2)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }

    private func pick(_ name: String) {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task {
            do {
                let c = try await Scryfall.shared.named(name)
                store.cache([c])
                onPick(c)
                text = ""; suggestions = []; error = nil
            } catch {
                if let c = OfflineCardDB.shared.card(named: name) {
                    onPick(c); text = ""; suggestions = []
                } else {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

@MainActor
struct StatTile: View {
    let label: String
    let value: String
    var sub: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.title3.bold()).monospacedDigit().foregroundStyle(Theme.gradient)
            if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
}

func share(_ text: String, filename: String) -> URL? {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
    do { try text.write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
}

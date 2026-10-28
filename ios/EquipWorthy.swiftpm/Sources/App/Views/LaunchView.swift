import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Every screen in the app, used by the launch page.
enum AppScreen: String, CaseIterable, Identifiable, Hashable {
    case dashboard, search, collection, batch, scan, decks, watchlist, market, secretLair, trade, life, sets, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .search: return "Search"
        case .collection: return "Collection"
        case .batch: return "Batch Entry"
        case .scan: return "Scan"
        case .decks: return "Decks"
        case .watchlist: return "Watchlist"
        case .market: return "Market Watch"
        case .secretLair: return "Secret Lair"
        case .trade: return "Trade Scale"
        case .life: return "Life & Dice"
        case .sets: return "Sets & Spoilers"
        case .settings: return "Settings"
        }
    }

    var blurb: String {
        switch self {
        case .dashboard: return "Portfolio value, movers and alerts"
        case .search: return "Any card's price, history and forecast"
        case .collection: return "Binders, conditions, set completion"
        case .batch: return "Paste lists, set grids, CSV imports"
        case .scan: return "Identify cards with your camera"
        case .decks: return "Build, check legality, see what to buy"
        case .watchlist: return "Price targets and alerts"
        case .market: return "Fast movers and synergy picks"
        case .secretLair: return "Drop reminders, launch link, line tracker"
        case .trade: return "Balance a trade, store trade-in"
        case .life: return "Life, commander damage, dice"
        case .sets: return "Upcoming sets and every release"
        case .settings: return "Profiles, sync, backups, buylist %"
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "chart.line.uptrend.xyaxis"
        case .search: return "magnifyingglass"
        case .collection: return "square.stack.3d.up"
        case .batch: return "list.bullet.rectangle"
        case .scan: return "camera.viewfinder"
        case .decks: return "rectangle.stack"
        case .watchlist: return "bell"
        case .market: return "chart.line.uptrend.xyaxis.circle"
        case .secretLair: return "star.square.on.square"
        case .trade: return "scalemass"
        case .life: return "heart.circle"
        case .sets: return "sparkles.rectangle.stack"
        case .settings: return "gearshape"
        }
    }

    var color: Color {
        switch self {
        case .dashboard, .batch, .watchlist, .sets: return Theme.sky
        case .search, .scan, .trade, .settings, .secretLair: return Theme.violet
        case .collection, .decks, .life, .market: return Theme.gold
        }
    }

    @MainActor @ViewBuilder var destination: some View {
        switch self {
        case .dashboard: DashboardView()
        case .search: SearchView()
        case .collection: CollectionView()
        case .batch: BatchView()
        case .scan: ScannerView()
        case .decks: DecksView()
        case .watchlist: WatchlistView()
        case .market: MarketView()
        case .secretLair: SecretLairView()
        case .trade: TradeView()
        case .life: LifeTrackerView()
        case .sets: SetsView()
        case .settings: SettingsView()
        }
    }

    /// A live detail shown on the tile, if there's something worth showing.
    @MainActor func stat(_ p: Profile) -> String? {
        switch self {
        case .dashboard:
            return p.collection.isEmpty ? nil : Snapshot.collectionValue(p).usd
        case .collection:
            let n = p.collection.reduce(0) { $0 + $1.quantity }
            return n == 0 ? nil : "\(n) cards"
        case .batch:
            let n = p.pendingBatch?.count ?? 0
            return n == 0 ? nil : "\(n) to review"
        case .decks:
            return p.decks.isEmpty ? nil : "\(p.decks.count) deck\(p.decks.count == 1 ? "" : "s")"
        case .watchlist:
            let n = p.alerts.filter { !$0.read }.count
            if n > 0 { return "\(n) new alert\(n == 1 ? "" : "s")" }
            return p.watchlist.isEmpty ? nil : "\(p.watchlist.count) watched"
        case .life:
            return p.game.map { "Turn \($0.turn) in progress" }
        case .secretLair:
            return LaunchView.nextDropText(p)
        case .market:
            guard let m = p.market else { return nil }
            if !m.movers.isEmpty { return "\(m.movers.count) fast mover\(m.movers.count == 1 ? "" : "s")" }
            return m.synergy.isEmpty ? nil : "\(m.synergy.count) synergy picks"
        default:
            return nil
        }
    }
}

@MainActor
struct LaunchView: View {
    static func nextDropText(_ p: Profile) -> String? {
        let now = Date()
        let upcoming = (p.secretLair ?? []).compactMap { d -> (SecretLairDrop, Date)? in
            guard d.marked, let s = d.saleStart, let t = parseISO(s), t.timeIntervalSince(now) > -7200 else { return nil }
            return (d, t)
        }.sorted { $0.1 < $1.1 }
        guard let next = upcoming.first else { return (p.secretLair ?? []).isEmpty ? nil : "\(p.secretLair!.count) followed" }
        return next.1 <= now ? "\(next.0.name): LIVE" : "Next: \(next.1.formatted(.dateTime.month(.abbreviated).day()))"
    }

    @EnvironmentObject var store: ProfileStore
    @State private var picked: CardSummary?

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 12)], spacing: 12) {
                    ForEach(AppScreen.allCases) { s in
                        NavigationLink(value: s) { LaunchTile(screen: s, stat: s.stat(store.profile)) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: AppScreen.self) { $0.destination }
        .navigationDestination(item: $picked) { CardDetailView(cardId: $0.id) }
        .saveToolbar()
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("EQUIPWORTHY TRACKING").font(.caption.bold()).tracking(1.5).foregroundStyle(Theme.gold)
            Text(greeting).font(.largeTitle.bold()).foregroundStyle(.white)
            Text("Where do you want to go?").foregroundStyle(.white.opacity(0.85))
            CardSearchField(prompt: "Quick lookup: any card name…") { picked = $0 }
                .padding(.top, 6)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Theme.sky, Theme.violet, Color(red: 0.23, green: 0.16, blue: 0.56)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 20))
    }
}

@MainActor
struct LaunchTile: View {
    let screen: AppScreen
    let stat: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: screen.symbol)
                .font(.title2)
                .foregroundStyle(screen.color)
                .frame(width: 46, height: 46)
                .background(screen.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
            Text(screen.title).font(.headline)
            Text(screen.blurb).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let stat { Text(stat).font(.caption.bold()).foregroundStyle(screen.color) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(
            LinearGradient(colors: [screen.color.opacity(0.16), Color(.secondarySystemGroupedBackground)], startPoint: .topLeading, endPoint: .center),
            in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(screen.color.opacity(0.35), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityHint(screen.blurb)
    }
}

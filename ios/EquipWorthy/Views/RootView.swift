import SwiftUI
import EquipWorthyKit

@MainActor
struct RootView: View {
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        TabView {
            NavigationStack { DashboardView() }
                .tabItem { Label("Home", systemImage: "chart.line.uptrend.xyaxis") }
            NavigationStack { CollectionView() }
                .tabItem { Label("Collection", systemImage: "square.stack.3d.up") }
            NavigationStack { ScannerView() }
                .tabItem { Label("Scan", systemImage: "camera.viewfinder") }
            NavigationStack { DecksView() }
                .tabItem { Label("Decks", systemImage: "rectangle.stack") }
            NavigationStack { MoreView() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .badge(store.profile.alerts.filter { !$0.read }.count)
        }
    }
}

@MainActor
struct MoreView: View {
    @EnvironmentObject var store: ProfileStore
    var body: some View {
        List {
            NavigationLink { SearchView() } label: { Label("Search", systemImage: "magnifyingglass") }
            NavigationLink { BatchView() } label: { Label("Batch Entry", systemImage: "list.bullet.rectangle") }
            NavigationLink { WatchlistView() } label: {
                Label("Watchlist & Alerts", systemImage: "bell")
                    .badge(store.profile.alerts.filter { !$0.read }.count)
            }
            NavigationLink { TradeView() } label: { Label("Trade Scale", systemImage: "scalemass") }
            NavigationLink { SetsView() } label: { Label("Sets & Spoilers", systemImage: "sparkles.rectangle.stack") }
            NavigationLink { SettingsView() } label: { Label("Settings & Profiles", systemImage: "gearshape") }
            Section {
                Text("Card data and prices from Scryfall (TCGplayer market, USD). Commander data from EDHREC. Not affiliated with Wizards of the Coast. Forecasts are estimates, not financial advice.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("More")
        .saveToolbar()
    }
}

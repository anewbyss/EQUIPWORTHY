import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct SecretLairView: View {
    @EnvironmentObject var store: ProfileStore
    enum Tab: String, CaseIterable { case following = "Following", catalog = "Recent drops" }
    @State private var tab = Tab.following
    @State private var newName = ""

    var drops: [SecretLairDrop] {
        (store.profile.secretLair ?? []).sorted { ($0.saleStart ?? "9") < ($1.saleStart ?? "9") }
    }

    var body: some View {
        List {
            Section {
                Picker("View", selection: $tab) { ForEach(Tab.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented)
                Link(destination: SecretLair.storeURL) { Label("Secret Lair store", systemImage: "arrow.up.right.square") }
            }
            switch tab {
            case .following:
                Section {
                    HStack {
                        TextField("New drop name", text: $newName)
                        Button("Add") {
                            let d = SecretLairDrop(name: newName.trimmingCharacters(in: .whitespaces).isEmpty ? "New Secret Lair drop" : newName)
                            store.mutate { $0.secretLair = [d] + ($0.secretLair ?? []) }
                            newName = ""
                        }
                    }
                } footer: {
                    Text("Add a drop when Wizards announces it, then set the sale time and paste the product link. Reminders arrive 24 hours, 1 hour, 15 minutes and 5 minutes before, then at launch. Tap one to open the drop.")
                }
                if drops.isEmpty {
                    Text("No drops yet. Add one above or follow one from Recent drops.").foregroundStyle(.secondary)
                }
                ForEach(drops) { d in
                    NavigationLink { DropDetailView(dropId: d.id) } label: { DropRow(drop: d) }
                }
                .onDelete { idx in
                    let ids = Set(idx.map { drops[$0].id })
                    store.mutate { $0.secretLair?.removeAll { ids.contains($0.id) } }
                }
            case .catalog:
                SecretLairCatalogSection()
            }
        }
        .navigationTitle("Secret Lair")
        .saveToolbar()
        .onAppear { Notifier.requestPermission() }
    }
}

@MainActor
struct DropRow: View {
    let drop: SecretLairDrop
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let state = SecretLair.state(drop, now: ctx.date)
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(drop.name).bold().lineLimit(1)
                    Text(drop.saleStart.flatMap(parseISO)?.formatted(date: .abbreviated, time: .shortened) ?? "Sale time not set")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if state == .live {
                    Text("● LIVE").font(.caption.bold()).foregroundStyle(Theme.gold)
                } else if let c = SecretLair.countdown(drop.saleStart, now: ctx.date), state != .ended {
                    Text(c).font(.callout.bold()).monospacedDigit().foregroundStyle(Theme.violet)
                }
                if drop.marked { Image(systemName: "bell.fill").font(.caption).foregroundStyle(Theme.sky) }
            }
        }
    }
}

@MainActor
struct DropDetailView: View {
    let dropId: String
    @EnvironmentObject var store: ProfileStore
    @State private var position = ""
    @State private var buyFinish: Finish = .nonfoil
    @State private var buyQty = 1
    @State private var paid = ""
    @State private var addToCollection = true

    private var drop: SecretLairDrop? { store.profile.secretLair?.first { $0.id == dropId } }

    private func edit(_ change: (inout SecretLairDrop) -> Void) {
        store.mutate { p in
            guard var list = p.secretLair, let i = list.firstIndex(where: { $0.id == dropId }) else { return }
            change(&list[i])
            list[i].updatedAt = isoNow()
            p.secretLair = list
        }
        if let d = drop { SecretLairNotifier.scheduleQueue(d) }
    }

    var body: some View {
        if let d = drop { content(d) } else { Text("Drop removed").foregroundStyle(.secondary) }
    }

    @ViewBuilder private func content(_ d: SecretLairDrop) -> some View {
        let p = store.profile
        let cards: [String: CardSummary] = p.cardCache.merging(p.secretLairCatalog?.cards ?? [:]) { a, _ in a }
        let value = SecretLair.value(d.cardIds, cards: cards)
        let foil = SecretLair.value(d.cardIds, cards: cards, finish: .foil)
        Form {
            Section {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let state = SecretLair.state(d, now: ctx.date)
                    VStack(alignment: .leading, spacing: 8) {
                        if state == .live {
                            Text("● LIVE NOW").font(.title2.bold()).foregroundStyle(Theme.gold)
                        } else if let c = SecretLair.countdown(d.saleStart, now: ctx.date), state != .ended {
                            Text(c).font(.system(size: 40, weight: .heavy, design: .rounded)).monospacedDigit().foregroundStyle(Theme.violet)
                        } else if state == .ended {
                            Text("Sale ended").foregroundStyle(.secondary)
                        }
                        Link(destination: SecretLair.launchURL(d)) {
                            Label(state == .live ? "Open the drop now" : "Open drop page", systemImage: "arrow.up.right.square.fill")
                                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(state == .live || state == .soon ? Theme.gold : Theme.violet.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(state == .live || state == .soon ? Color.black : Theme.violet)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Toggle("Remind me", isOn: Binding(get: { d.marked }, set: { v in edit { $0.marked = v } }))
                if !d.cardIds.isEmpty {
                    LabeledContent("Cards worth", value: value.total.usd + (foil.total > value.total ? " (foil \(foil.total.usd))" : ""))
                    if let price = d.price, value.priced > 0 {
                        Text(value.total >= price ? "Worth more than the \(price.usd) price" : "Worth less than the \(price.usd) price")
                            .font(.caption).foregroundStyle(value.total >= price ? Theme.up : Theme.down)
                    }
                }
            }

            if SecretLair.state(d) == .soon || SecretLair.state(d) == .live || d.queue != nil, d.owned == nil {
                queueSection(d)
            }

            Section("Sale details") {
                TextField("Name", text: Binding(get: { d.name }, set: { v in edit { $0.name = v } }))
                DatePicker("Goes on sale", selection: Binding(
                    get: { d.saleStart.flatMap(parseISO) ?? Date().addingTimeInterval(86400) },
                    set: { v in edit { $0.saleStart = isoNow(v); $0.remindersSent = [] } }))
                if d.saleStart == nil { Text("Set the sale time to get reminders.").font(.caption).foregroundStyle(.secondary) }
                TextField("Price $", value: Binding(get: { d.price }, set: { v in edit { $0.price = v } }), format: .number).keyboardType(.decimalPad)
                TextField("Foil price $", value: Binding(get: { d.foilPrice }, set: { v in edit { $0.foilPrice = v } }), format: .number).keyboardType(.decimalPad)
                TextField("Drop link (https://secretlair.wizards.com/…)", text: Binding(get: { d.url ?? "" }, set: { v in edit { $0.url = v.trimmingCharacters(in: .whitespaces).isEmpty ? nil : v.trimmingCharacters(in: .whitespaces) } }))
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            }

            Section {
                ForEach(SecretLair.checklist, id: \.key) { c in
                    Toggle(isOn: Binding(get: { SecretLair.isChecked(d, c.key) }, set: { v in edit { $0.checklist[c.key] = v } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.label)
                            Text(c.detail).font(.caption).foregroundStyle(.secondary)
                            if let link = c.link { Link("Open ↗", destination: link).font(.caption) }
                        }
                    }
                }
            } header: {
                Text("Be ready to buy · \(Int(SecretLair.readiness(d) * 100))%")
            } footer: {
                Text("EquipWorthy doesn't join the line or buy for you. Automated entries break Secret Lair's terms of sale and can get orders cancelled. It gets you to the official page at the right moment, ready to check out.")
            }

            if !d.cardIds.isEmpty {
                Section("Cards") {
                    ScrollView(.horizontal) {
                        HStack { ForEach(d.cardIds, id: \.self) { id in NavigationLink { CardDetailView(cardId: id) } label: { CardImage(url: cards[id]?.imageSmall, width: 70) } } }
                    }
                }
            }

            Section("Got it?") { ownedSection(d) }
        }
        .navigationTitle(d.name)
        .navigationBarTitleDisplayMode(.inline)
        .saveToolbar()
        .onAppear { UIApplication.shared.isIdleTimerDisabled = SecretLair.state(d) == .soon || SecretLair.state(d) == .live }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    @ViewBuilder private func queueSection(_ d: SecretLairDrop) -> some View {
        Section {
            HStack {
                TextField("Place in line", text: $position).keyboardType(.numberPad)
                Button("Update") { addReading() }.buttonStyle(.borderedProminent).tint(Theme.violet)
            }
            TimelineView(.periodic(from: .now, by: 5)) { ctx in
                let est = d.queue.flatMap { SecretLair.estimate($0, now: ctx.date) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(d.queue?.admittedAt != nil ? "You're through. Go check out!" : SecretLair.etaText(est)).font(.headline)
                    if let at = est?.etaAt, let m = est?.etaMinutes, m > 0, d.queue?.admittedAt == nil {
                        Text("Estimated through at \(at.formatted(date: .omitted, time: .shortened)). Estimates firm up with more readings.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if d.queue != nil && d.queue?.admittedAt == nil {
                Button("I'm through!") { edit { $0.queue?.admittedAt = isoNow() } }
            }
            if d.queue != nil { Button("Reset line tracker", role: .destructive) { edit { $0.queue = nil } } }
        } header: {
            Text("In line?")
        } footer: {
            Text("When the official waiting room shows your place, type it here every minute or two (switch back to Safari in between and leave that tab alone). EquipWorthy estimates your wait and notifies you when you're about 5 minutes and 1 minute away.")
        }
    }

    private func addReading() {
        guard let n = Int(position.filter(\.isNumber)) else { return }
        edit { d in
            var q = d.queue ?? QueueLog()
            q.entries.append(QueueReading(isoNow(), n))
            d.queue = q
        }
        position = ""
    }

    @ViewBuilder private func ownedSection(_ d: SecretLairDrop) -> some View {
        if let o = d.owned {
            Text("You bought \(o.quantity)× (\(o.finish.label))" + (o.paid.map { " for \($0.usd) each" } ?? ""))
            Button("Undo") { edit { $0.owned = nil } }
        } else {
            Picker("Version", selection: $buyFinish) { ForEach(Finish.allCases) { Text($0.label).tag($0) } }
            Stepper("Quantity: \(buyQty)", value: $buyQty, in: 1...20)
            TextField("Paid each $", text: $paid).keyboardType(.decimalPad)
            if !d.cardIds.isEmpty { Toggle("Add cards to collection", isOn: $addToCollection) }
            Button("I bought it") { recordPurchase(d) }.bold()
        }
    }

    private func recordPurchase(_ d: SecretLairDrop) {
        let paidNum = Double(paid) ?? d.price
        let finish = buyFinish, qty = buyQty, addCards = addToCollection
        edit { $0.owned = OwnedDrop(finish: finish, quantity: qty, paid: paidNum) }
        guard addCards, !d.cardIds.isEmpty else { return }
        store.mutate { p in
            if !p.binders.contains("Secret Lair") { p.binders.append("Secret Lair") }
            let perCard = paidNum.map { ($0 / Double(d.cardIds.count) * 100).rounded() / 100 }
            var fresh: [CardSummary] = []
            for id in d.cardIds {
                let c = p.cardCache[id] ?? p.secretLairCatalog?.cards[id]
                if let c { fresh.append(c) }
                let f: Finish = (c?.finishes.contains(finish) ?? true) ? finish : (c?.finishes.first ?? finish)
                p.collection.append(CollectionItem(cardId: id, name: c?.name ?? "Secret Lair card", set: c?.set ?? "sld", collectorNumber: c?.collectorNumber ?? "",
                                                   finish: f, quantity: qty, purchasePrice: perCard, purchaseDate: dayString(), binder: "Secret Lair"))
            }
            p = Snapshot.apply(p, fresh: fresh)
        }
    }
}

@MainActor
struct SecretLairCatalogSection: View {
    @EnvironmentObject var store: ProfileStore
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        let cat = store.profile.secretLairCatalog
        Section {
            Button(loading ? "Loading Secret Lair cards…" : "Reload") { Task { await load() } }.disabled(loading)
            if let error { Text(error).foregroundStyle(Theme.down).font(.caption) }
        } footer: {
            Text("Grouped from Scryfall by release date and collector number. Scryfall doesn't name drops, so groups are named after their cards; rename them after you follow one. Upcoming drops appear once their cards are previewed.")
        }
        if let cat {
            Section("\(cat.groups.count) drops") {
                ForEach(cat.groups.prefix(80)) { g in
                    let v = SecretLair.value(g.cardIds, cards: cat.cards)
                    HStack {
                        CardImage(url: g.cardIds.first.flatMap { cat.cards[$0]?.imageSmall }, width: 36)
                        VStack(alignment: .leading) {
                            Text(g.name).lineLimit(2)
                            Text("\(g.releasedAt) · \(g.cardIds.count) cards · \(v.total.usd)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Follow") { follow(g, cat) }.buttonStyle(.bordered)
                    }
                }
            }
        }
        Color.clear.frame(height: 0).listRowBackground(Color.clear)
            .task {
                let stale = cat.flatMap { parseISO($0.fetchedAt) }.map { Date().timeIntervalSince($0) > 3 * 86400 } ?? true
                if stale { await load() }
            }
    }

    private func follow(_ g: SecretLairGroup, _ cat: SecretLairCatalog) {
        store.cache(g.cardIds.compactMap { cat.cards[$0] })
        guard !(store.profile.secretLair ?? []).contains(where: { $0.cardIds == g.cardIds }) else { return }
        let d = SecretLairDrop(name: g.name, cardIds: g.cardIds, marked: false)
        store.mutate { $0.secretLair = [d] + ($0.secretLair ?? []) }
    }

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            var cards: [CardSummary] = []
            for page in 1...4 {
                let r = try await Scryfall.shared.search("e:sld", unique: "prints", order: "released", dir: "desc", page: page)
                cards += r.cards
                if !r.hasMore { break }
            }
            var slim: [String: CardSummary] = [:]
            for c in cards { var x = c; x.oracleText = nil; slim[c.id] = x }
            let groups = SecretLair.groupDrops(cards)
            store.mutate { $0.secretLairCatalog = SecretLairCatalog(cards: slim, groups: groups, fetchedAt: isoNow()) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// App-wide strip shown from 15 minutes before a followed drop until 2 hours after it opens.
@MainActor
struct LaunchStripView: View {
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let hot = (store.profile.secretLair ?? []).filter { d in
                guard d.marked, d.owned == nil, let s = d.saleStart, let start = parseISO(s) else { return false }
                let t = start.timeIntervalSince(ctx.date)
                return t <= 15 * 60 && t > -2 * 3600
            }
            if let d = hot.first {
                HStack {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(d.name).font(.caption.bold()).lineLimit(1)
                        Text(SecretLair.state(d, now: ctx.date) == .live ? "is LIVE" : "goes live in \(SecretLair.countdown(d.saleStart, now: ctx.date) ?? "")")
                            .font(.caption).monospacedDigit()
                    }
                    Spacer()
                    Link("Open the drop", destination: SecretLair.launchURL(d))
                        .font(.caption.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Theme.gold, in: Capsule()).foregroundStyle(.black)
                }
                .padding(.horizontal, 14).padding(.vertical, 8)
                .foregroundStyle(.white)
                .background(LinearGradient(colors: [Theme.violet, Color(red: 0.23, green: 0.16, blue: 0.56)], startPoint: .leading, endPoint: .trailing))
            }
        }
    }
}

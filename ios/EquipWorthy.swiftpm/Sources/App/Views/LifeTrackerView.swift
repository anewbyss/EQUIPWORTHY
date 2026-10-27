import SwiftUI
import UIKit
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct LifeTrackerView: View {
    @EnvironmentObject var store: ProfileStore
    @State private var showDice = false
    @State private var showLog = false

    private func setGame(_ change: (GameState) -> GameState) {
        store.mutate { p in if let g = p.game { p.game = change(g) } }
    }

    var body: some View {
        Group {
            if let game = store.profile.game {
                ScrollView {
                    LazyVGrid(columns: game.players.count <= 1 ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        ForEach(Array(game.players.enumerated()), id: \.element.id) { i, p in
                            PlayerCard(player: p, game: game, active: i == game.activePlayer, setGame: setGame)
                        }
                    }
                    .padding(.horizontal, 10)
                    Button { setGame { Game.nextTurn($0) } } label: {
                        Label("Next turn · Turn \(game.turn), \(game.players[game.activePlayer].name)", systemImage: "arrow.forward.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.violet).padding()
                }
            } else {
                GameSetup { g in store.mutate { $0.game = g } }
            }
        }
        .navigationTitle("Life & Dice")
        .navigationBarTitleDisplayMode(.inline)
        .saveToolbar()
        .toolbar {
            if let game = store.profile.game {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button { showDice = true } label: { Image(systemName: "dice") }.accessibilityLabel("Dice")
                    Button { showLog = true } label: { Image(systemName: "list.bullet.rectangle") }.accessibilityLabel("Game log")
                    Menu {
                        Button("Rematch (same players)") { store.mutate { $0.game = Game.rematch(game) } }
                        Button("New game", role: .destructive) { store.mutate { $0.game = nil } }
                    } label: { Image(systemName: "arrow.counterclockwise") }
                }
            }
        }
        .sheet(isPresented: $showDice) { DiceSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showLog) { GameLogSheet().presentationDetents([.medium, .large]) }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }  // keep the screen on during games
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

@MainActor
private struct GameSetup: View {
    let onStart: (GameState) -> Void
    @State private var players = 4
    @State private var life = 40
    @State private var names = Array(repeating: "", count: 8)

    var body: some View {
        Form {
            Section("Players") {
                Picker("Players", selection: $players) { ForEach(1...6, id: \.self) { Text("\($0)").tag($0) } }.pickerStyle(.segmented)
                ForEach(0..<players, id: \.self) { i in TextField("Player \(i + 1)", text: $names[i]) }
            }
            Section("Starting life") {
                Picker("Starting life", selection: $life) {
                    Text("20").tag(20); Text("25").tag(25); Text("30").tag(30); Text("40").tag(40)
                }
                .pickerStyle(.segmented)
                Stepper("Custom: \(life)", value: $life, in: 1...999)
            }
            Button { onStart(Game.new(players: players, startingLife: life, names: names)) } label: {
                Text("Start game").bold().frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).tint(Theme.violet)
        }
    }
}

@MainActor
private struct PlayerCard: View {
    let player: GamePlayer
    let game: GameState
    let active: Bool
    let setGame: ((GameState) -> GameState) -> Void
    @State private var showCounters = false

    var color: Color { Theme.player(player.color) }

    var body: some View {
        let dead = Game.eliminated(player)
        VStack(spacing: 6) {
            HStack {
                Text(player.name).font(.subheadline.bold()).lineLimit(1)
                Spacer()
                if active { Text("Active").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.gold.opacity(0.25), in: Capsule()).foregroundStyle(Theme.gold) }
            }
            HStack(spacing: 0) {
                lifeButton("minus", -1)
                Text("\(player.life)")
                    .font(.system(size: 56, weight: .heavy, design: .rounded)).monospacedDigit()
                    .foregroundStyle(color).minimumScaleFactor(0.5).lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .contentTransition(.numericText())
                    .accessibilityLabel("\(player.name) life \(player.life)")
                lifeButton("plus", 1)
            }
            HStack {
                Button("−5") { life(-5) }
                Spacer()
                Button("+5") { life(5) }
            }
            .font(.caption.bold()).buttonStyle(.bordered).tint(color)
            if let dead { Text("Eliminated by \(dead)").font(.caption.bold()).foregroundStyle(Theme.down) }
            HStack(spacing: 8) {
                ForEach(Counter.allCases, id: \.self) { c in
                    let v = player[keyPath: c.keyPath]
                    if v > 0 { Text("\(icon(c)) \(v)").font(.caption2.bold()) }
                }
                let cmd = player.commanderDamage.values.max() ?? 0
                if cmd > 0 { Text("⚔ \(cmd)").font(.caption2.bold()).foregroundStyle(cmd >= Game.commanderLethal ? Theme.down : .primary) }
            }
            Button(showCounters ? "Hide counters" : "Counters & commander damage") { showCounters.toggle() }.font(.caption2)
            if showCounters {
                ForEach(Counter.allCases, id: \.self) { c in
                    stepper("\(icon(c)) \(c.label)", value: player[keyPath: c.keyPath]) { d in setGame { Game.change($0, id: player.id, counter: c, delta: d) } }
                }
                ForEach(game.players.filter { $0.id != player.id }) { o in
                    stepper("⚔ from \(o.name)", value: player.commanderDamage[o.id] ?? 0, tint: Theme.player(o.color)) { d in
                        setGame { Game.commanderDamage($0, target: player.id, from: o.id, delta: d) }
                    }
                }
            }
        }
        .padding(10)
        .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(active ? Theme.gold : color.opacity(0.5), lineWidth: active ? 3 : 1.5))
        .opacity(dead == nil ? 1 : 0.55)
        .animation(.snappy, value: player.life)
    }

    private func life(_ d: Int) {
        setGame { Game.changeLife($0, id: player.id, delta: d) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func lifeButton(_ symbol: String, _ d: Int) -> some View {
        Button { life(d) } label: {
            Image(systemName: symbol).font(.title3.bold()).frame(width: 44, height: 44)
                .background(Circle().stroke(color, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(player.name) \(d > 0 ? "plus" : "minus") 1")
    }

    private func stepper(_ label: String, value: Int, tint: Color? = nil, change: @escaping (Int) -> Void) -> some View {
        HStack {
            Text(label).font(.caption).lineLimit(1)
            Spacer()
            Button { change(-1) } label: { Image(systemName: "minus.circle") }.buttonStyle(.plain)
            Text("\(value)").font(.callout.bold()).monospacedDigit().frame(minWidth: 22)
            Button { change(1) } label: { Image(systemName: "plus.circle") }.buttonStyle(.plain)
        }
        .padding(.leading, 6)
        .overlay(alignment: .leading) { if let tint { Rectangle().fill(tint).frame(width: 3) } }
    }

    private func icon(_ c: Counter) -> String {
        switch c {
        case .poison: return "☠"
        case .energy: return "⚡"
        case .experience: return "✦"
        case .commanderTax: return "⟳"
        }
    }
}

@MainActor
struct DiceSheet: View {
    @EnvironmentObject var store: ProfileStore
    @State private var count = 1
    @State private var modifier = 0
    @State private var bounce = 0

    private func add(_ r: DiceRoll) {
        store.mutate { p in if let g = p.game { p.game = Game.add(g, roll: r) } }
        bounce += 1
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    var body: some View {
        let rolls = store.profile.game?.rolls ?? []
        NavigationStack {
            Form {
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 10) {
                        ForEach([4, 6, 8, 10, 12, 20, 100], id: \.self) { d in
                            Button { add(Game.roll(count: count, sides: d, modifier: modifier)) } label: {
                                Text("d\(d)").font(.headline).frame(maxWidth: .infinity, minHeight: 54)
                                    .background(Theme.sky.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.violet, lineWidth: 2))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Stepper("Dice: \(count)", value: $count, in: 1...100)
                    Stepper("Modifier: \(modifier >= 0 ? "+" : "")\(modifier)", value: $modifier, in: -50...50)
                    HStack {
                        Button("Flip coin") { add(Game.flipCoin()) }
                        Spacer()
                        Button("Random player") { if let g = store.profile.game { add(Game.randomPlayer(g)) } }
                    }
                    .buttonStyle(.bordered)
                }
                if let last = rolls.first {
                    Section {
                        VStack {
                            Text(last.text ?? "\(last.total)").font(.system(size: 56, weight: .heavy, design: .rounded)).foregroundStyle(Theme.gold)
                                .contentTransition(.numericText())
                            Text(last.label + (last.results.count > 1 && last.label.contains("d") ? " · \(last.results.map(String.init).joined(separator: ", "))" : ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .id(bounce)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                if rolls.count > 1 {
                    Section("Earlier") {
                        ForEach(Array(rolls.dropFirst().prefix(15).enumerated()), id: \.offset) { _, r in
                            LabeledContent(r.label, value: r.text ?? "\(r.total)")
                        }
                    }
                }
            }
            .navigationTitle("Dice")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

@MainActor
struct GameLogSheet: View {
    @EnvironmentObject var store: ProfileStore
    var body: some View {
        NavigationStack {
            List(Array((store.profile.game?.log ?? []).enumerated()), id: \.offset) { _, l in
                VStack(alignment: .leading) {
                    Text(l.text)
                    Text(parseISO(l.at)?.formatted(date: .omitted, time: .shortened) ?? "").font(.caption).foregroundStyle(.secondary)
                }
            }
            .overlay { if store.profile.game?.log.isEmpty ?? true { ContentUnavailableView("No events yet", systemImage: "list.bullet") } }
            .navigationTitle("Game log")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

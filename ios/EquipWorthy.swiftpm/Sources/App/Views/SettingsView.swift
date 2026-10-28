import SwiftUI
import UniformTypeIdentifiers
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

@MainActor
struct SettingsView: View {
    @EnvironmentObject var store: ProfileStore
    @EnvironmentObject var refresher: PriceRefresher
    @State private var newName = ""
    @State private var exporting = false
    @State private var importing = false
    @State private var exportDoc: BackupDocument?
    @State private var message: String?
    @State private var offlineStatus: String?
    @State private var downloading = false

    private func setting<T>(_ kp: WritableKeyPath<AppSettings, T>) -> Binding<T> {
        Binding(get: { store.profile.settings[keyPath: kp] }, set: { v in store.mutate { $0.settings[keyPath: kp] = v } })
    }

    var body: some View {
        let p = store.profile
        Form {
            if let message { Text(message).foregroundStyle(Theme.up) }

            SyncSection()

            ReminderDeliverySection()

            Section {
                ForEach(store.profiles) { m in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(m.name).fontWeight(m.id == p.id ? .bold : .regular)
                            Text("\(m.cards) cards").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if m.id == p.id { Text("Active").font(.caption).foregroundStyle(.secondary) }
                        else { Button("Switch") { Task { await store.switchTo(m.id) } }.buttonStyle(.borderless) }
                    }
                }
                .onDelete { idx in
                    let ids = idx.map { store.profiles[$0].id }
                    Task { for id in ids { await store.delete(id) } }
                }
                TextField("Rename active profile", text: Binding(get: { p.name }, set: { v in store.mutate { $0.name = v } }))
                HStack {
                    TextField("New profile name", text: $newName)
                    Button("Create") { let n = newName; newName = ""; Task { await store.create(name: n) } }.disabled(newName.isEmpty)
                }
            } header: { Text("Profiles") } footer: { Text("Each profile is stored only on this device: collection, decks, watchlist, trades and price history.") }

            Section {
                Picker("Autosave every", selection: setting(\.autosaveSeconds)) {
                    ForEach([10, 20, 30, 60, 120], id: \.self) { Text("\($0) seconds").tag($0) }
                }
                Button("Save now") { Task { message = await store.save() ? "Saved." : "Save failed." } }
                Button("Export backup (.json)") {
                    if let d = try? store.exportData() { exportDoc = BackupDocument(data: d); exporting = true }
                }
                Button("Import / restore backup") { importing = true }
            } header: { Text("Saving & backups") } footer: {
                Text("EquipWorthy saves 1.5 s after every change, every \(p.settings.autosaveSeconds) s while there are unsaved changes, and whenever the app leaves the foreground. Use Save on any screen to save right away. Backups also open in the EquipWorthy web app.")
            }

            Section("Store buylist") {
                PctSlider(label: "Cash offer", value: setting(\.buylistCashPct))
                PctSlider(label: "Store credit", value: setting(\.buylistCreditPct))
                ForEach(Condition.allCases) { c in
                    HStack {
                        Text("\(c.rawValue) multiplier")
                        Spacer()
                        TextField("1.0", value: Binding(get: { p.settings.multiplier(c) }, set: { v in store.mutate { $0.settings.conditionMultipliers[c.rawValue] = v } }), format: .number)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                    }
                }
            }

            Section("Defaults & prices") {
                Picker("Default condition", selection: setting(\.defaultCondition)) { ForEach(Condition.allCases) { Text($0.rawValue).tag($0) } }
                Picker("Default binder", selection: setting(\.defaultBinder)) { ForEach(p.binders, id: \.self) { Text($0).tag($0) } }
                Picker("Automatic price updates", selection: setting(\.autoRefreshHours)) {
                    Text("Once a day").tag(24.0); Text("Twice a day").tag(12.0); Text("Every 6 hours").tag(6.0)
                }
                Toggle("Price-alert notifications", isOn: setting(\.notifications))
                Button("Refresh prices now") { Task { await refresher.refreshAll(force: true) } }
                if let last = p.lastPriceRefresh.flatMap(parseISO) { LabeledContent("Last refresh", value: last.formatted()) }
            }

            Section {
                if OfflineCardDB.shared.isInstalled {
                    LabeledContent("Installed", value: OfflineCardDB.shared.installedDate?.formatted(date: .abbreviated, time: .omitted) ?? "yes")
                    Button("Update offline database") { downloadOffline() }.disabled(downloading)
                    Button("Remove", role: .destructive) { OfflineCardDB.shared.remove(); offlineStatus = "Removed" }
                } else {
                    Button("Download offline card database") { downloadOffline() }.disabled(downloading)
                }
                if let offlineStatus { Text(offlineStatus).font(.footnote).foregroundStyle(.secondary) }
            } header: { Text("Offline mode") } footer: {
                Text("Lets search and scanning find cards at a shop with no signal. Prices still need a connection to update. About a 150 MB download; use Wi-Fi.")
            }

            Section {
                Stepper("Alert at ±\(Int(p.settings.spikePct1d))% in a day", value: setting(\.spikePct1d), in: 1...200, step: 1)
                Stepper("or ±\(Int(p.settings.spikePct7d))% in a week", value: setting(\.spikePct7d), in: 1...500, step: 1)
                Stepper("Ignore cards under \(p.settings.moverMinPrice.usd)", value: setting(\.moverMinPrice), in: 0...100, step: 0.25)
                Toggle("Daily market scan", isOn: setting(\.marketScan))
                if p.settings.marketScan {
                    Picker("Cards to scan", selection: setting(\.marketUniverse)) {
                        ForEach([175, 350, 525, 700, 1050], id: \.self) { Text("Top \($0) by EDHREC").tag($0) }
                    }
                }
            } header: { Text("Fast movers & market scan") } footer: {
                Text("Your own cards raise an alert when they move past these thresholds. The daily market scan watches popular Commander cards for spikes and drops, and finds older cards likely to rise from new-set synergies.")
            }

            Section("Storage") {
                LabeledContent("Cached cards", value: "\(p.cardCache.count)")
                LabeledContent("Price histories", value: "\(p.priceHistory.count)")
            }
        }
        .navigationTitle("Settings")
        .saveToolbar()
        .fileExporter(isPresented: $exporting, document: exportDoc, contentType: .json, defaultFilename: "equipworthy-\(p.name)-\(dayString()).json") { r in
            if case .success = r { message = "Backup exported." }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { r in
            guard case .success(let url) = r else { return }
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { message = "Couldn't read file."; return }
            Task {
                do { try await store.importBackup(data); message = "Imported \(store.profile.name)." }
                catch { message = "Import failed: \(error.localizedDescription)" }
            }
        }
    }

    private func downloadOffline() {
        downloading = true
        Task {
            do {
                try await OfflineCardDB.shared.download { s in Task { @MainActor in offlineStatus = s } }
            } catch {
                offlineStatus = "Download failed: \(error.localizedDescription)"
            }
            downloading = false
        }
    }
}

@MainActor
struct SyncSection: View {
    @EnvironmentObject var sync: SyncManager
    @EnvironmentObject var store: ProfileStore
    @State private var token = ""
    @State private var pass = ""
    @State private var pass2 = ""
    @State private var busy = false
    @State private var message: String?

    static let tokenURL = URL(string: "https://github.com/settings/tokens/new?scopes=gist&description=EquipWorthy%20sync")!

    var body: some View {
        Section {
            if let cfg = sync.config {
                HStack {
                    if let e = sync.error { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.down).font(.footnote) }
                    else if sync.syncing { ProgressView(); Text("Syncing…") }
                    else if let d = sync.lastSync { Label("Synced \(d.formatted(.relative(presentation: .named)))", systemImage: "checkmark.icloud").foregroundStyle(Theme.up) }
                    else { Text("Connected") }
                }
                Button("Sync now") { Task { await sync.syncNow() } }.disabled(sync.syncing)
                Toggle("Sync automatically", isOn: Binding(get: { cfg.autoSync }, set: { sync.setAutoSync($0) }))
                let missing = sync.remote.filter { r in !store.profiles.contains { $0.id == r.profileId } && store.profile.id != r.profileId }
                ForEach(missing, id: \.profileId) { r in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(r.name)
                            Text("On another device · \(parseISO(r.updatedAt)?.formatted() ?? "")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Download") { Task { await sync.download(r) } }.buttonStyle(.borderless)
                    }
                }
                Button("Turn off sync on this device", role: .destructive) { sync.disconnect() }
            } else {
                Link("1. Create a GitHub token (gist permission only)", destination: Self.tokenURL)
                SecureField("2. Paste the token (ghp_…)", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("3. Sync passphrase", text: $pass)
                SecureField("Repeat passphrase", text: $pass2)
                Button(busy ? "Connecting…" : "Turn on sync") { Task { await connect() } }
                    .bold().disabled(busy || token.isEmpty || pass.isEmpty)
            }
            if let message { Text(message).font(.footnote).foregroundStyle(Theme.down) }
        } header: {
            Text("Sync between devices")
        } footer: {
            Text("Keeps this app and the EquipWorthy web app in sync. Profiles are encrypted with your passphrase on this device and stored in a private Gist on your GitHub account. Use the same token and passphrase everywhere. Edits from different devices are merged. Card images and prices are downloaded on each device rather than synced.")
        }
        .task { await sync.refreshRemote() }
    }

    private func connect() async {
        message = nil
        guard pass.count >= 8 else { message = "Use a passphrase of at least 8 characters."; return }
        guard pass == pass2 else { message = "The passphrases don't match."; return }
        busy = true
        defer { busy = false }
        do {
            try await sync.connect(token: token, passphrase: pass)
            token = ""; pass = ""; pass2 = ""
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Secret Lair reminders by push alert (ntfy app) and text message (your own SMS worker).
@MainActor
struct ReminderDeliverySection: View {
    @EnvironmentObject var store: ProfileStore
    @EnvironmentObject var channels: ReminderChannels
    @State private var topic = ""
    @State private var server = ""
    @State private var workerUrl = ""
    @State private var key = ""
    @State private var message: String?
    @State private var failed = false

    static let ntfyApp = URL(string: "https://apps.apple.com/app/ntfy/id1625396347")!
    static let smsGuide = URL(string: "https://github.com/anewbyss/EQUIPWORTHY/blob/main/sms-worker/README.md")!

    var body: some View {
        let s = store.profile.settings
        Section {
            Link("Get the free ntfy app", destination: Self.ntfyApp)
            HStack {
                TextField("Topic", text: $topic).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("New") { topic = Channels.newTopic() }.buttonStyle(.borderless)
            }
            TextField("Server", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Toggle("Push alerts on", isOn: Binding(get: { s.ntfyEnabled }, set: { v in applyNtfy(v) }))
            Button("Save topic & send a test") { applyNtfy(true); run { try await Channels.testNtfy(store.profile.settings) } }
                .disabled(topic.isEmpty)
        } header: { Text("Push alerts (ntfy)") } footer: {
            Text("Subscribe to the same topic in the ntfy app. Reminders are scheduled on ntfy up to 3 days ahead, so they arrive even with EquipWorthy closed. Anyone who knows the topic can read the alerts, so keep the generated name.")
        }
        .onAppear(perform: load)

        Section {
            Link("Setup guide (about 15 minutes)", destination: Self.smsGuide)
            TextField("Text service URL (https://…workers.dev)", text: $workerUrl)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            SecureField("App key", text: $key)
            Toggle("Text reminders on", isOn: Binding(get: { s.smsEnabled }, set: { v in applySms(v) }))
            Button("Save & send a test text") { applySms(true); run { try await Channels.testSms(store.profile.settings) } }
                .disabled(workerUrl.isEmpty || key.isEmpty)
            Button("Re-send reminder schedule") { run { await channels.sync(force: true); if let e = channels.error { throw Channels.ChannelError(e) } } }
                .disabled(!s.smsEnabled && !s.ntfyEnabled)
        } header: { Text("Text messages") } footer: {
            Text("Real SMS sent by your own EquipWorthy text service (Cloudflare + Twilio, about $1–2 a month plus about 1¢ per text). It only ever texts your number. Your Twilio keys stay in the service, never in this app.")
        }

        if let message {
            Text(message).font(.footnote).foregroundStyle(failed ? Theme.down : Theme.up)
        } else if let e = channels.error {
            Label(e, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Theme.down)
        }
    }

    private func load() {
        let s = store.profile.settings
        topic = s.ntfyTopic ?? ""
        server = s.ntfyServer
        workerUrl = s.smsWorkerUrl ?? ""
        key = s.smsKey ?? ""
    }

    private func applyNtfy(_ on: Bool) {
        let t = topic.trimmingCharacters(in: .whitespaces)
        let srv = server.trimmingCharacters(in: .whitespaces)
        store.mutate {
            $0.settings.ntfyTopic = t.isEmpty ? nil : t
            $0.settings.ntfyServer = srv.isEmpty ? "https://ntfy.sh" : srv
            $0.settings.ntfyEnabled = on && !t.isEmpty
        }
    }

    private func applySms(_ on: Bool) {
        let u = workerUrl.trimmingCharacters(in: .whitespaces)
        let k = key.trimmingCharacters(in: .whitespaces)
        store.mutate {
            $0.settings.smsWorkerUrl = u.isEmpty ? nil : u
            $0.settings.smsKey = k.isEmpty ? nil : k
            $0.settings.smsEnabled = on && !u.isEmpty && !k.isEmpty
        }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        message = nil
        Task {
            do { try await work(); failed = false; message = "Sent. Check your phone." }
            catch { failed = true; message = error.localizedDescription }
        }
    }
}

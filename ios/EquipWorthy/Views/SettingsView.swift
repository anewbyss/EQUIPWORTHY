import SwiftUI
import UniformTypeIdentifiers
import EquipWorthyKit

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
                Picker("Auto-refresh prices", selection: setting(\.autoRefreshHours)) {
                    ForEach([6.0, 12, 24, 48], id: \.self) { Text("Every \(Int($0)) h").tag($0) }
                }
                Toggle("Price-alert notifications", isOn: setting(\.notifications))
                Button("Refresh prices now") { Task { await store.refreshPrices() } }
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

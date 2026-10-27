import SwiftUI
import AVFoundation
import AudioToolbox
import PhotosUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.preview.session = session
        v.preview.videoGravity = .resizeAspectFill
        return v
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

@MainActor
struct ScannerView: View {
    @EnvironmentObject var store: ProfileStore
    @StateObject private var scanner = CardScanner()
    @State private var rapid = true
    @State private var finish: Finish = .nonfoil
    @State private var torch = false
    @State private var current: CardSummary?
    @State private var session: [CardSummary] = []
    @State private var lastAddedId: String?
    @State private var looking = false
    @State private var photo: PhotosPickerItem?
    @State private var status = "Line the card up inside the frame"

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if scanner.permissionDenied {
                    ContentUnavailableView("Camera access needed", systemImage: "camera.fill", description: Text("Allow camera access in Settings to scan cards."))
                } else {
                    CameraPreview(session: scanner.session).ignoresSafeArea(edges: .horizontal)
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(scanner.cardFound ? Theme.sky : Theme.gold, lineWidth: 3)
                        .aspectRatio(63.0 / 88.0, contentMode: .fit)
                        .padding(36)
                        .allowsHitTesting(false)
                }
                VStack {
                    Spacer()
                    if let c = current {
                        HStack {
                            CardImage(url: c.imageSmall, width: 44)
                            VStack(alignment: .leading) {
                                Text(c.name).bold().lineLimit(1)
                                Text("\(c.set.uppercased()) #\(c.collectorNumber)").font(.caption)
                            }
                            Spacer()
                            Text(c.price(finish).usd).font(.title2.bold()).monospacedDigit()
                            if !rapid { Button("Add") { add(c) }.buttonStyle(.borderedProminent) }
                        }
                        .padding(10).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12)).padding()
                    } else {
                        Text(status).font(.footnote).padding(8).background(.ultraThinMaterial, in: Capsule()).padding()
                    }
                }
            }
            .frame(maxHeight: .infinity)

            VStack(spacing: 8) {
                HStack {
                    Toggle("Rapid mode", isOn: $rapid).fixedSize()
                    Spacer()
                    Picker("Finish", selection: $finish) { ForEach(Finish.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented).frame(maxWidth: 220)
                }
                HStack {
                    Button { torch.toggle(); scanner.toggleTorch(torch) } label: { Image(systemName: torch ? "flashlight.on.fill" : "flashlight.off.fill") }
                    PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "photo") }
                    Spacer()
                    Text("\(session.count) scanned · \(session.reduce(0) { $0 + ($1.price(finish) ?? 0) }.usd)").font(.footnote).monospacedDigit()
                    Spacer()
                    NavigationLink { BatchView() } label: { Text("Review (\(store.profile.pendingBatch?.count ?? 0))") }.buttonStyle(.borderedProminent)
                }
            }
            .padding()
        }
        .navigationTitle("Scan")
        .navigationBarTitleDisplayMode(.inline)
        .saveToolbar()
        .onAppear {
            scanner.onStableHints = { h in Task { await handle(h) } }
            scanner.start()
        }
        .onDisappear { scanner.stop(); torch = false }
        .onChange(of: photo) { _, item in
            Task {
                guard let item, let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) else { return }
                if let h = scanner.recognize(still: img) { lastAddedId = nil; await handle(h) } else { status = "Couldn't read that photo." }
            }
        }
    }

    @MainActor
    private func handle(_ h: ScanHints) async {
        guard !looking else { return }
        looking = true
        defer { looking = false }
        guard let card = await ScanLookup.lookup(h) else {
            status = "No match for “\(h.name ?? "?")”"
            return
        }
        current = card
        store.cache([card])
        if rapid && card.id != lastAddedId { add(card) }
    }

    private func add(_ card: CardSummary) {
        lastAddedId = card.id
        session.insert(card, at: 0)
        let f = card.finishes.contains(finish) ? finish : (card.finishes.first ?? .nonfoil)
        let line = BatchLine(raw: card.name, quantity: 1, name: card.name, set: card.set, collectorNumber: card.collectorNumber, finish: f)
        let cond = store.profile.settings.defaultCondition
        store.mutate { p in
            p.cardCache[card.id] = card
            p.pendingBatch = (p.pendingBatch ?? []) + [PendingRow(raw: card.name, status: .ok, card: card, line: line, condition: cond, source: .scan)]
        }
        AudioServicesPlaySystemSound(1057)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}

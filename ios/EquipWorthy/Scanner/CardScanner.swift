import AVFoundation
import CoreImage
import Vision
import UIKit
import EquipWorthyKit

/// Live camera card recognizer.
///
/// For each sampled frame: find the card rectangle (VNDetectRectanglesRequest),
/// flatten it with a perspective correction, then OCR (VNRecognizeTextRequest).
/// Text in the title bar gives the name. The bottom-left line gives the set code
/// and collector number, which identify the exact printing on 2020+ cards.
final class CardScanner: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    @Published var hints: ScanHints?
    @Published var running = false
    @Published var permissionDenied = false
    @Published var cardFound = false

    /// Called on the main thread when the same hints are read on two consecutive frames.
    var onStableHints: ((ScanHints) -> Void)?

    private let queue = DispatchQueue(label: "equipworthy.scanner")
    private let ci = CIContext()
    private var lastProcessed = Date.distantPast
    private var previous: ScanHints?
    private var busy = false
    var interval: TimeInterval = 0.35

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureAndRun()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                if ok { self.configureAndRun() } else { DispatchQueue.main.async { self.permissionDenied = true } }
            }
        default: permissionDenied = true
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async { self.running = false }
        }
    }

    private func configureAndRun() {
        queue.async {
            if self.session.inputs.isEmpty {
                self.session.beginConfiguration()
                self.session.sessionPreset = .hd1920x1080
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input) else {
                    self.session.commitConfiguration(); return
                }
                self.session.addInput(input)
                if (try? device.lockForConfiguration()) != nil {
                    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                    if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
                    device.unlockForConfiguration()
                }
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: self.queue)
                if self.session.canAddOutput(output) { self.session.addOutput(output) }
                if let conn = output.connection(with: .video), conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
                self.session.commitConfiguration()
            }
            self.session.startRunning()
            DispatchQueue.main.async { self.running = true }
        }
    }

    func toggleTorch(_ on: Bool) {
        guard let d = AVCaptureDevice.default(for: .video), d.hasTorch, (try? d.lockForConfiguration()) != nil else { return }
        d.torchMode = on ? .on : .off
        d.unlockForConfiguration()
    }

    // MARK: Frames

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !busy, Date().timeIntervalSince(lastProcessed) >= interval,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        busy = true
        lastProcessed = Date()
        defer { busy = false }
        let image = CIImage(cvPixelBuffer: pixels)
        let card = flattenCard(image)
        DispatchQueue.main.async { self.cardFound = card != nil }
        guard let h = recognize(card ?? centerCrop(image)) else { return }
        let stable = h == previous
        previous = h
        DispatchQueue.main.async {
            self.hints = h
            if stable { self.onStableHints?(h) }
        }
    }

    /// Process a still photo (e.g. from the photo library).
    func recognize(still: UIImage) -> ScanHints? {
        guard let cg = still.cgImage else { return nil }
        let img = CIImage(cgImage: cg)
        return recognize(flattenCard(img) ?? img)
    }

    private func flattenCard(_ image: CIImage) -> CIImage? {
        let req = VNDetectRectanglesRequest()
        req.minimumAspectRatio = 0.6
        req.maximumAspectRatio = 0.8
        req.minimumSize = 0.3
        req.minimumConfidence = 0.7
        req.maximumObservations = 1
        try? VNImageRequestHandler(ciImage: image).perform([req])
        guard let r = req.results?.first else { return nil }
        let size = image.extent.size
        func pt(_ p: CGPoint) -> CIVector { CIVector(x: p.x * size.width, y: p.y * size.height) }
        guard let f = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
        f.setValue(image, forKey: kCIInputImageKey)
        f.setValue(pt(r.topLeft), forKey: "inputTopLeft")
        f.setValue(pt(r.topRight), forKey: "inputTopRight")
        f.setValue(pt(r.bottomLeft), forKey: "inputBottomLeft")
        f.setValue(pt(r.bottomRight), forKey: "inputBottomRight")
        return f.outputImage
    }

    /// Fallback when no card edge is found: the area inside the on-screen guide.
    private func centerCrop(_ image: CIImage) -> CIImage {
        let e = image.extent
        return image.cropped(to: CGRect(x: e.minX + e.width * 0.18, y: e.minY + e.height * 0.06, width: e.width * 0.64, height: e.height * 0.88))
    }

    private func recognize(_ card: CIImage) -> ScanHints? {
        guard let cg = ci.createCGImage(card, from: card.extent) else { return nil }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        req.recognitionLanguages = ["en-US"]
        try? VNImageRequestHandler(cgImage: cg).perform([req])
        let obs = req.results ?? []
        // Vision uses a bottom-left origin with normalized coordinates.
        let title = obs.filter { $0.boundingBox.minY > 0.84 && $0.boundingBox.minX < 0.5 }
            .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
            .compactMap { $0.topCandidates(1).first?.string }
        let bottom = obs.filter { $0.boundingBox.maxY < 0.12 && $0.boundingBox.minX < 0.6 }
            .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
            .compactMap { $0.topCandidates(1).first?.string }
        let h = ScanParser.parse(nameText: title.prefix(1).joined(separator: "\n"), bottomText: bottom.joined(separator: "\n"))
        return (h.name == nil && h.collectorNumber == nil) ? nil : h
    }
}

/// Turns scan hints into an exact card, preferring set + collector number.
enum ScanLookup {
    static func lookup(_ h: ScanHints) async -> CardSummary? {
        if let s = h.set, let n = h.collectorNumber, let c = try? await Scryfall.shared.card(set: s, number: n) {
            if h.name == nil || ScanParser.similarity(h.name!, c.name) > 0.5 { return c }
        }
        if let name = h.name {
            if let c = try? await Scryfall.shared.named(name, fuzzy: true, set: h.set) { return c }
            if let c = try? await Scryfall.shared.named(name, fuzzy: true) { return c }
            return OfflineCardDB.shared.card(named: name)
        }
        return nil
    }
}

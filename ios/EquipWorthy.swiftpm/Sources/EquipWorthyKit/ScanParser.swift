import Foundation

// Turn OCR text from a card into lookup hints. Port of web/src/lib/scanparse.ts.

public struct ScanHints: Hashable, Sendable {
    public var name: String?
    public var set: String?
    public var collectorNumber: String?
    public init(name: String? = nil, set: String? = nil, collectorNumber: String? = nil) {
        self.name = name; self.set = set; self.collectorNumber = collectorNumber
    }
}

public enum ScanParser {
    static let langs = "EN|JP|JA|DE|FR|IT|ES|SP|PT|RU|KO|KR|CS|CT|ZHS|ZHT|PH"
    static let notSets: Set<String> = ["EN", "TM", "LLC", "WOTC", "THE", "AND", "OF"]

    public static func cleanName(_ raw: String) -> String? {
        let lines = raw.components(separatedBy: .newlines).map(\.trimmed).filter { Rx.test("[A-Za-z]{3,}", $0) }
        let letters: (String) -> Int = { $0.filter { $0.isLetter }.count }
        guard let line = lines.max(by: { letters($0) < letters($1) }) else { return nil }
        var cleaned = Rx.replace("[^A-Za-z\\u00C0-\\u017F ,'\\-/]", in: line, with: " ")
        cleaned = Rx.replace("\\s+", in: cleaned, with: " ").trimmed
        cleaned = Rx.replace("(\\s[A-Za-z]{1,2})+$", in: cleaned, with: "").trimmed
        return cleaned.count >= 3 ? cleaned : nil
    }

    public static func parseCollectorLine(_ raw: String) -> (set: String?, collectorNumber: String?) {
        let text = raw.uppercased().replacingOccurrences(of: "|", with: "I")
        var number: String?
        if let m = Rx.first("\\b0*(\\d{1,4})\\s*/\\s*\\d{1,4}\\b", in: text) {
            number = m[1]
        } else if let m = Rx.first("(?:^|\\s)[CURMSLTP]?\\s?0*(\\d{1,4}[A-Z]?)(?=\\s|$)", in: text, .anchorsMatchLines) {
            number = m[1]
        }
        var set: String?
        if let m = Rx.first("\\b([A-Z0-9]{3,5})\\s*[•·.*\\-]?\\s*(?:\(langs))\\b", in: text), let s = m[1], !notSets.contains(s), Rx.test("[A-Z]", s) {
            set = s
        } else {
            set = Rx.all("\\b[A-Z][A-Z0-9]{2,4}\\b", in: text).first { !notSets.contains($0) && !Rx.test("^(\(langs))$", $0) }
        }
        return (set?.lowercased(), number)
    }

    public static func parse(nameText: String, bottomText: String) -> ScanHints {
        let c = parseCollectorLine(bottomText)
        return ScanHints(name: cleanName(nameText), set: c.set, collectorNumber: c.collectorNumber)
    }

    /// Dice coefficient on letter bigrams, 0...1.
    public static func similarity(_ a: String, _ b: String) -> Double {
        func bigrams(_ s: String) -> [String] {
            let t = Array(s.lowercased().filter { $0 >= "a" && $0 <= "z" })
            guard t.count >= 2 else { return [] }
            return (0..<(t.count - 1)).map { String(t[$0...$0 + 1]) }
        }
        let x = bigrams(a), y = bigrams(b)
        guard !x.isEmpty, !y.isEmpty else { return 0 }
        var counts: [String: Int] = [:]
        x.forEach { counts[$0, default: 0] += 1 }
        var hit = 0
        for g in y where (counts[g] ?? 0) > 0 { hit += 1; counts[g]! -= 1 }
        return 2 * Double(hit) / Double(x.count + y.count)
    }
}

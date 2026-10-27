import Foundation

// Batch entry parsing. Port of web/src/lib/batch.ts; keep the two in sync.

public struct BatchLine: Hashable, Sendable {
    public var lineNo: Int
    public var raw: String
    public var quantity: Int
    public var name: String
    public var set: String?
    public var setName: String?
    public var collectorNumber: String?
    public var finish: Finish
    public var condition: Condition?
    public var language: String?
    public var purchasePrice: Double?
    public var scryfallId: String?
    public var board: Board?

    public init(lineNo: Int = 0, raw: String, quantity: Int = 1, name: String, set: String? = nil, setName: String? = nil,
                collectorNumber: String? = nil, finish: Finish = .nonfoil, condition: Condition? = nil, language: String? = nil,
                purchasePrice: Double? = nil, scryfallId: String? = nil, board: Board? = nil) {
        self.lineNo = lineNo; self.raw = raw; self.quantity = quantity; self.name = name; self.set = set; self.setName = setName
        self.collectorNumber = collectorNumber; self.finish = finish; self.condition = condition; self.language = language
        self.purchasePrice = purchasePrice; self.scryfallId = scryfallId; self.board = board
    }
}

public enum BatchParser {
    private static let sections: [(String, Board)] = [
        ("^(commander|commanders)\\b:?$", .commander),
        ("^(deck|main|mainboard|main deck|companion)\\b:?$", .main),
        ("^(sideboard|side)\\b:?$", .side),
        ("^(maybeboard|maybe|considering)\\b:?$", .maybe),
    ]

    public static func parseLine(_ raw: String, lineNo: Int = 0) -> BatchLine? {
        var s = raw.trimmed
        if s.isEmpty || s.hasPrefix("//") || s.hasPrefix("#") { return nil }
        var board: Board?
        if Rx.test("^SB:\\s*", s, .caseInsensitive) {
            board = .side
            s = Rx.replace("^SB:\\s*", in: s, with: "", .caseInsensitive)
        }

        var finish = Finish.nonfoil
        if Rx.test("\\*E\\*|\\betched\\b", s, .caseInsensitive) { finish = .etched }
        else if Rx.test("\\*F\\*|\\(foil\\)|\\bfoil\\b", s, .caseInsensitive) { finish = .foil }
        s = Rx.replace("\\*[EF]\\*|\\(foil\\)|\\b(etched|foil)\\b", in: s, with: " ", .caseInsensitive)

        s = Rx.replace("\\s#[A-Za-z][\\w-]*", in: s, with: " ")
        var purchasePrice: Double?
        if let m = Rx.first("\\s@\\s*\\$?(\\d+(?:\\.\\d+)?)\\s*$", in: s) {
            purchasePrice = Double(m[1] ?? "")
            s = String(s[..<m.range.lowerBound])
        }

        var condition: Condition?
        if let m = Rx.first("\\s\\[?(NM|LP|MP|HP|DMG)\\]?\\s*$", in: s, .caseInsensitive) {
            condition = CSVImport.parseCondition(m[1])
            s = String(s[..<m.range.lowerBound])
        }

        var quantity = 1
        if let m = Rx.first("^(\\d+)\\s*x?\\s+", in: s, .caseInsensitive) {
            quantity = Int(m[1] ?? "1") ?? 1
            s = String(s[m.range.upperBound...])
        }

        var set: String?
        var collectorNumber: String?
        if let m = Rx.first("\\s[(\\[]([A-Za-z0-9]{2,6})[)\\]](?:\\s+#?([A-Za-z0-9★\\-]+))?\\s*$", in: s) {
            set = m[1]?.lowercased()
            collectorNumber = m[2]
            s = String(s[..<m.range.lowerBound])
        }

        let name = Rx.replace("\\s+", in: s, with: " ").trimmed
        if name.isEmpty { return nil }
        return BatchLine(lineNo: lineNo, raw: raw, quantity: quantity, name: name, set: set, collectorNumber: collectorNumber,
                         finish: finish, condition: condition, purchasePrice: purchasePrice, board: board)
    }

    public static func parseList(_ text: String) -> [BatchLine] {
        var out: [BatchLine] = []
        var board = Board.main
        var sawBlank = false
        let lines = text.components(separatedBy: .newlines)
        for (i, raw) in lines.enumerated() {
            let t = raw.trimmed
            if t.isEmpty {
                if !out.isEmpty { sawBlank = true }
                continue
            }
            if let sec = sections.first(where: { Rx.test($0.0, t, .caseInsensitive) }) {
                board = sec.1
                sawBlank = false
                continue
            }
            guard var line = parseLine(raw, lineNo: i + 1) else { continue }
            if line.board == nil { line.board = (sawBlank && board == .main) ? .side : board }
            out.append(line)
        }
        return out
    }

    /// "12, 45f, 3x88, 10-14, 101e" for one set. f = foil, e = etched, Nx = quantity.
    public static func parseSetGrid(set: String, _ text: String) -> [BatchLine] {
        var out: [BatchLine] = []
        let tokens = text.components(separatedBy: CharacterSet(charactersIn: " ,;\n\t\r")).filter { !$0.isEmpty }
        for tok in tokens {
            guard let m = Rx.first("^(?:(\\d+)x)?(\\d+[a-dg-z★]?)(?:-(\\d+))?([fe])?$", in: tok, .caseInsensitive) else {
                out.append(BatchLine(lineNo: out.count + 1, raw: tok, quantity: 0, name: "", set: set.lowercased(), collectorNumber: tok))
                continue
            }
            let qty = Int(m[1] ?? "") ?? 1
            let f = m[4]?.lowercased()
            let finish: Finish = f == "f" ? .foil : f == "e" ? .etched : .nonfoil
            let start = m[2] ?? ""
            var numbers: [String] = []
            if let end = m[3], let a = Int(start), let b = Int(end) {
                for n in min(a, b)...max(a, b) where numbers.count < 500 { numbers.append(String(n)) }
            } else {
                numbers.append(start)
            }
            for n in numbers {
                out.append(BatchLine(lineNo: out.count + 1, raw: tok, quantity: qty, name: "", set: set.lowercased(), collectorNumber: n, finish: finish))
            }
        }
        return out
    }
}

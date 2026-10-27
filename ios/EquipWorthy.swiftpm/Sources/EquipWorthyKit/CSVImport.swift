import Foundation

// CSV import/export with column auto-detection. Port of web/src/lib/csv.ts.

public enum CSVImport {
    public enum Field: String, CaseIterable, Sendable {
        case quantity, name, set, collectorNumber, finish, condition, language, purchasePrice, scryfallId
    }

    static let aliases: [(Field, [String])] = [
        (.quantity, ["count", "quantity", "qty", "amount", "total quantity", "add to quantity"]),
        (.name, ["name", "card name", "card", "product name", "simple name"]),
        (.set, ["set code", "edition code", "set", "edition", "setcode"]),
        (.collectorNumber, ["collector number", "card number", "number", "collector #", "cn", "col #"]),
        (.finish, ["foil", "finish", "printing", "foil/variant", "is foil"]),
        (.condition, ["condition", "cond"]),
        (.language, ["language", "lang"]),
        (.purchasePrice, ["purchase price", "price bought", "cost", "acquired price", "purchase_price"]),
        (.scryfallId, ["scryfall id", "scryfall_id", "scryfallid"]),
    ]

    public static func parse(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var cell = ""
        var quoted = false
        var chars = Array(text)
        if chars.first == "\u{FEFF}" { chars.removeFirst() }
        var i = 0
        func endRow() {
            row.append(cell)
            if row.contains(where: { !$0.trimmed.isEmpty }) { rows.append(row) }
            row = []; cell = ""
        }
        while i < chars.count {
            let ch = chars[i]
            if quoted {
                if ch == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" { cell.append("\""); i += 1 } else { quoted = false }
                } else { cell.append(ch) }
            } else if ch == "\"" {
                quoted = true
            } else if ch == "," {
                row.append(cell); cell = ""
            } else if ch == "\n" || ch == "\r" || ch == "\r\n" {
                if ch == "\r" && i + 1 < chars.count && chars[i + 1] == "\n" { i += 1 }
                endRow()
            } else {
                cell.append(ch)
            }
            i += 1
        }
        endRow()
        return rows
    }

    public static func row(_ cells: [String]) -> String {
        cells.map { c in
            c.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" }) ? "\"\(c.replacingOccurrences(of: "\"", with: "\"\""))\"" : c
        }.joined(separator: ",")
    }

    public static func detectColumns(_ header: [String]) -> [Field: Int] {
        let norm = header.map { $0.trimmed.lowercased() }
        var out: [Field: Int] = [:]
        var used = Set<Int>()
        for (field, names) in aliases {
            for alias in names {
                if let idx = norm.indices.first(where: { norm[$0] == alias && !used.contains($0) }) {
                    out[field] = idx; used.insert(idx); break
                }
            }
        }
        return out
    }

    public static func parseFinish(_ v: String?) -> Finish {
        let s = (v ?? "").trimmed.lowercased()
        if s.contains("etch") { return .etched }
        if ["foil", "true", "yes", "1", "f", "y"].contains(s) || s.hasPrefix("foil") { return .foil }
        return .nonfoil
    }

    public static func parseCondition(_ v: String?) -> Condition? {
        let s = (v ?? "").trimmed.lowercased().replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        if s.isEmpty { return nil }
        if s == "nm" || s.hasPrefix("near mint") || s == "mint" || s == "m" { return .NM }
        if s == "lp" || s.hasPrefix("light") || s == "ex" || s == "excellent" || s == "sp" || s.hasPrefix("slightly") { return .LP }
        if s == "mp" || s.hasPrefix("moderately") || s == "good" || s == "gd" || s.hasPrefix("played") || s == "pl" { return .MP }
        if s == "hp" || s.hasPrefix("heavily") || s == "poor" { return .HP }
        if s.hasPrefix("dmg") || s.hasPrefix("damaged") { return .DMG }
        return nil
    }

    static let languages: [String: String] = [
        "english": "en", "japanese": "ja", "german": "de", "french": "fr", "italian": "it", "spanish": "es",
        "portuguese": "pt", "russian": "ru", "korean": "ko", "chinese simplified": "zhs", "chinese traditional": "zht",
    ]

    public static func parseLanguage(_ v: String?) -> String {
        let s = (v ?? "").trimmed.lowercased()
        return s.isEmpty ? "en" : (languages[s] ?? s)
    }

    public struct Result { public var lines: [BatchLine]; public var error: String? }

    public static func toBatch(_ text: String) -> Result {
        let rows = parse(text)
        guard rows.count >= 2 else { return Result(lines: [], error: "CSV needs a header row and at least one card.") }
        let cols = detectColumns(rows[0])
        guard cols[.name] != nil || cols[.scryfallId] != nil else { return Result(lines: [], error: "Couldn't find a Name or Scryfall ID column.") }
        func at(_ r: [String], _ f: Field) -> String? {
            guard let i = cols[f], i < r.count else { return nil }
            return r[i].trimmed
        }
        var lines: [BatchLine] = []
        for (i, r) in rows.dropFirst().enumerated() {
            let qty = Int(at(r, .quantity) ?? "1") ?? 1
            let setVal = at(r, .set) ?? ""
            let priceStr = (at(r, .purchasePrice) ?? "").filter { "0123456789.".contains($0) }
            let line = BatchLine(
                lineNo: i + 2, raw: r.joined(separator: ","), quantity: qty > 0 ? qty : 1, name: at(r, .name) ?? "",
                set: (!setVal.isEmpty && setVal.count <= 6) ? setVal.lowercased() : nil,
                setName: setVal.count > 6 ? setVal : nil,
                collectorNumber: (at(r, .collectorNumber)).flatMap { $0.isEmpty ? nil : $0 },
                finish: parseFinish(at(r, .finish)), condition: parseCondition(at(r, .condition)),
                language: parseLanguage(at(r, .language)), purchasePrice: Double(priceStr),
                scryfallId: (at(r, .scryfallId)).flatMap { $0.isEmpty ? nil : $0 })
            if !line.name.isEmpty || line.scryfallId != nil { lines.append(line) }
        }
        return Result(lines: lines, error: nil)
    }

    /// Moxfield collection CSV export.
    public static func moxfieldCSV(_ items: [CollectionItem]) -> String {
        let cond: [Condition: String] = [.NM: "Near Mint", .LP: "Lightly Played", .MP: "Moderately Played", .HP: "Heavily Played", .DMG: "Damaged"]
        var out = [row(["Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags", "Collector Number", "Purchase Price"])]
        for i in items {
            out.append(row([String(i.quantity), i.binder == "Trade Binder" ? String(i.quantity) : "0", i.name, i.set, cond[i.condition] ?? "Near Mint",
                            i.language, i.finish == .foil ? "foil" : i.finish == .etched ? "etched" : "", "", i.collectorNumber,
                            i.purchasePrice.map { String(format: "%.2f", $0) } ?? ""]))
        }
        return out.joined(separator: "\n")
    }

    public static func equipWorthyCSV(_ items: [CollectionItem], profile: Profile) -> String {
        var out = [row(["Quantity", "Name", "Set code", "Collector number", "Finish", "Condition", "Language", "Binder", "Location", "Purchase price", "Market price", "Scryfall ID"])]
        for i in items {
            out.append(row([String(i.quantity), i.name, i.set, i.collectorNumber, i.finish.rawValue, i.condition.rawValue, i.language, i.binder,
                            i.location ?? "", i.purchasePrice.map { String(format: "%.2f", $0) } ?? "",
                            String(format: "%.2f", profile.price(i.cardId, i.finish) ?? 0), i.cardId]))
        }
        return out.joined(separator: "\n")
    }
}

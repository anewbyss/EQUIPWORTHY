import Foundation

/// Small NSRegularExpression helpers (works on iOS and Linux).
struct RegexMatch {
    let range: Range<String.Index>
    let groups: [String?]
    subscript(_ i: Int) -> String? { i < groups.count ? groups[i] : nil }
}

enum Rx {
    private static var cache: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func re(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        let key = "\(options.rawValue)|\(pattern)"
        lock.lock(); defer { lock.unlock() }
        if let r = cache[key] { return r }
        // Patterns are compile-time constants; a bad one is a programmer error.
        let r = try! NSRegularExpression(pattern: pattern, options: options)
        cache[key] = r
        return r
    }

    static func first(_ pattern: String, in s: String, _ options: NSRegularExpression.Options = []) -> RegexMatch? {
        let ns = NSRange(s.startIndex..., in: s)
        guard let m = re(pattern, options).firstMatch(in: s, range: ns), let r = Range(m.range, in: s) else { return nil }
        var groups: [String?] = []
        for i in 0..<m.numberOfRanges {
            if let gr = Range(m.range(at: i), in: s) { groups.append(String(s[gr])) } else { groups.append(nil) }
        }
        return RegexMatch(range: r, groups: groups)
    }

    static func all(_ pattern: String, in s: String, _ options: NSRegularExpression.Options = []) -> [String] {
        let ns = NSRange(s.startIndex..., in: s)
        return re(pattern, options).matches(in: s, range: ns).compactMap { Range($0.range, in: s).map { String(s[$0]) } }
    }

    static func test(_ pattern: String, _ s: String, _ options: NSRegularExpression.Options = []) -> Bool {
        first(pattern, in: s, options) != nil
    }

    static func replace(_ pattern: String, in s: String, with t: String, _ options: NSRegularExpression.Options = []) -> String {
        re(pattern, options).stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

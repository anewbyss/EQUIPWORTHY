// swift-tools-version:5.9

// Command-line package for the shared core (EquipWorthyKit) so it can be tested
// with `swift test` from this folder. The sources live inside the app package
// (EquipWorthy.swiftpm/Sources/EquipWorthyKit) so there's a single copy.

import PackageDescription

let package = Package(
    name: "EquipWorthyKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "EquipWorthyKit", targets: ["EquipWorthyKit"]),
    ],
    targets: [
        .target(name: "EquipWorthyKit", path: "EquipWorthy.swiftpm/Sources/EquipWorthyKit"),
        .testTarget(name: "EquipWorthyKitTests", dependencies: ["EquipWorthyKit"], path: "Tests/EquipWorthyKitTests"),
    ]
)

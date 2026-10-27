// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "EquipWorthyKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "EquipWorthyKit", targets: ["EquipWorthyKit"]),
    ],
    targets: [
        .target(name: "EquipWorthyKit"),
        .testTarget(name: "EquipWorthyKitTests", dependencies: ["EquipWorthyKit"]),
    ]
)

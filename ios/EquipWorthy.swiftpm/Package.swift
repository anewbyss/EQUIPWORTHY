// swift-tools-version: 5.9

// EquipWorthy app package. Opens directly in Swift Playgrounds (iPad / Mac) and
// in Xcode. The whole app, including the shared EquipWorthyKit sources, builds
// as a single target so it works in Swift Playgrounds.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "EquipWorthy",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "EquipWorthy",
            targets: ["EquipWorthy"],
            bundleIdentifier: "com.equipworthy.tracking",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .magicWand),
            accentColor: .presetColor(.purple),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            capabilities: [
                .camera(purposeString: "EquipWorthy uses the camera to scan and identify Magic cards.")
            ],
            appCategory: .utilities
        )
    ],
    targets: [
        .executableTarget(
            name: "EquipWorthy",
            path: "Sources"
        )
    ]
)

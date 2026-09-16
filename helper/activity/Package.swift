// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "sb-activity",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "sb-activity", path: "Sources/sb-activity")
    ]
)

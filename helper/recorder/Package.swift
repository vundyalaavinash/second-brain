// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "sb-recorder",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "sb-recorder", path: "Sources/sb-recorder")
    ]
)
